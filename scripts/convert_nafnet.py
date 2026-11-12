"""
Build public/models/nafnet_sidd_w32.onnx from the official NAFNet-SIDD-width32 checkpoint (MIT, megvii-research/NAFNet).
No upstream ONNX exists for width32, so we export it ourselves. Needs: python3, torch, onnx (pip install torch onnx).
Run: python3 scripts/convert_nafnet.py   (downloads the checkpoint + official model code, verifies sha256, exports)
"""
import hashlib, os, sys, tempfile, urllib.request
import numpy as np, onnx, torch
from onnx import helper, numpy_helper, TensorProto

CKPT = 'https://huggingface.co/nyanko7/nafnet-models/resolve/main/NAFNet-SIDD-width32.pth'
CKPT_SHA = '89c70e808d1783b6c07911306e106aaf0d4f7f3da8c61078b99ff7f8929a26f4'  # == official release (width64 sibling matches the author's own copy)
SRC = 'https://raw.githubusercontent.com/megvii-research/NAFNet/main/basicsr/models/archs/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'models', 'nafnet_sidd_w32.onnx')
TILE = 512  # the app tiles larger images

work = tempfile.mkdtemp()
arch = os.path.join(work, 'basicsr', 'models', 'archs'); os.makedirs(arch); os.makedirs(os.path.join(work, 'basicsr', 'utils'))
for d in ['basicsr', 'basicsr/models', 'basicsr/models/archs']: open(os.path.join(work, d, '__init__.py'), 'w').close()
open(os.path.join(work, 'basicsr', 'utils', '__init__.py'), 'w').write('import logging\ndef get_root_logger(*a, **k): return logging.getLogger("x")\n')
for f in ['NAFNet_arch.py', 'arch_util.py', 'local_arch.py']: urllib.request.urlretrieve(SRC + f, os.path.join(arch, f))
ckpt = os.path.join(work, 'w32.pth'); urllib.request.urlretrieve(CKPT, ckpt)
assert hashlib.sha256(open(ckpt, 'rb').read()).hexdigest() == CKPT_SHA, 'checkpoint sha256 mismatch'

sys.path.insert(0, work)
from basicsr.models.archs import arch_util
from basicsr.models.archs.NAFNet_arch import NAFNet
net = NAFNet(img_channel=3, width=32, middle_blk_num=12, enc_blk_nums=[2, 2, 4, 8], dec_blk_nums=[2, 2, 2, 2])
net.load_state_dict(torch.load(ckpt, map_location='cpu', weights_only=True)['params'], strict=True); net.eval()
def ln(self, x):  # LayerNorm2d without the custom autograd.Function (not exportable); identical math
    mu = x.mean(1, keepdim=True); var = (x - mu).pow(2).mean(1, keepdim=True)
    return self.weight.view(1, -1, 1, 1) * ((x - mu) / (var + self.eps).sqrt()) + self.bias.view(1, -1, 1, 1)
for m in net.modules():
    if isinstance(m, arch_util.LayerNorm2d): m.forward = ln.__get__(m)
fp32 = os.path.join(work, 'fp32.onnx')
torch.onnx.export(net, torch.rand(1, 3, TILE, TILE), fp32, input_names=['image'], output_names=['denoised'], opset_version=17, dynamo=False)

# fp16 weights + Cast → fp32 compute: half the download, same results on WASM and WebGPU
m = onnx.load(fp32); g = m.graph; inits, casts = [], []
for t in g.initializer:
    a = numpy_helper.to_array(t)
    if a.dtype == np.float32 and a.size > 16:
        inits.append(numpy_helper.from_array(a.astype(np.float16), t.name + '_h'))
        casts.append(helper.make_node('Cast', [t.name + '_h'], [t.name], to=TensorProto.FLOAT))
    else: inits.append(t)
del g.initializer[:]; g.initializer.extend(inits)
nodes = casts + list(g.node); del g.node[:]; g.node.extend(nodes)
onnx.checker.check_model(m); os.makedirs(os.path.dirname(OUT), exist_ok=True); onnx.save(m, OUT)
urllib.request.urlretrieve('https://raw.githubusercontent.com/megvii-research/NAFNet/main/LICENSE', OUT.replace('.onnx', '.LICENSE.txt'))
print('wrote', OUT, os.path.getsize(OUT), 'bytes sha256', hashlib.sha256(open(OUT, 'rb').read()).hexdigest())
