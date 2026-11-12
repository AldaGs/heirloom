"""
Build public/models/mobilesam_{encoder,decoder}.onnx from the official MobileSAM release (Apache-2.0, ChaoningZhang/MobileSAM).
Encoder has SAM's pixel normalisation baked in (input: RGB 0..255, long side resized to 1024, zero-padded to 1024²).
Decoder is MobileSAM's own SamOnnxModel (single best mask). Needs: pip install torch onnx timm
Run: python3 scripts/convert_mobilesam.py
"""
import hashlib, os, sys, tempfile, urllib.request
import numpy as np, onnx, torch
from onnx import helper, numpy_helper, TensorProto

G = 'https://raw.githubusercontent.com/ChaoningZhang/MobileSAM/master/'
WEIGHTS_SHA = '6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f'
FILES = ['mobile_sam/__init__.py', 'mobile_sam/build_sam.py', 'mobile_sam/predictor.py', 'mobile_sam/automatic_mask_generator.py',
         'mobile_sam/modeling/__init__.py', 'mobile_sam/modeling/common.py', 'mobile_sam/modeling/image_encoder.py', 'mobile_sam/modeling/mask_decoder.py',
         'mobile_sam/modeling/prompt_encoder.py', 'mobile_sam/modeling/sam.py', 'mobile_sam/modeling/transformer.py', 'mobile_sam/modeling/tiny_vit_sam.py',
         'mobile_sam/utils/__init__.py', 'mobile_sam/utils/amg.py', 'mobile_sam/utils/onnx.py', 'mobile_sam/utils/transforms.py', 'weights/mobile_sam.pt', 'LICENSE']
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models')

work = tempfile.mkdtemp()
for f in FILES:
    os.makedirs(os.path.join(work, os.path.dirname(f)), exist_ok=True); urllib.request.urlretrieve(G + f, os.path.join(work, f))
w = os.path.join(work, 'weights', 'mobile_sam.pt')
assert hashlib.sha256(open(w, 'rb').read()).hexdigest() == WEIGHTS_SHA, 'weights sha256 mismatch'
sys.path.insert(0, work)
from mobile_sam import sam_model_registry
from mobile_sam.utils.onnx import SamOnnxModel
torch.manual_seed(0)
sam = sam_model_registry['vit_t'](checkpoint=w); sam.eval()

class Enc(torch.nn.Module):
    def __init__(s, sam): super().__init__(); s.e = sam.image_encoder; s.register_buffer('m', sam.pixel_mean); s.register_buffer('sd', sam.pixel_std)
    def forward(s, x): return s.e((x - s.m) / s.sd)
enc, dec = os.path.join(work, 'enc.onnx'), os.path.join(work, 'dec.onnx')
torch.onnx.export(Enc(sam), torch.zeros(1, 3, 1024, 1024), enc, input_names=['image'], output_names=['image_embeddings'], opset_version=17, dynamo=False)
d = {'image_embeddings': torch.zeros(1, 256, 64, 64), 'point_coords': torch.zeros(1, 5, 2), 'point_labels': torch.zeros(1, 5),
     'mask_input': torch.zeros(1, 1, 256, 256), 'has_mask_input': torch.zeros(1), 'orig_im_size': torch.tensor([1500., 2250.])}
torch.onnx.export(SamOnnxModel(sam, return_single_mask=True), tuple(d.values()), dec, input_names=list(d), output_names=['masks', 'iou_predictions', 'low_res_masks'],
                  dynamic_axes={'point_coords': {1: 'n'}, 'point_labels': {1: 'n'}}, opset_version=17, dynamo=False)

def half(src, dst):  # fp16 weights + Cast → fp32 compute
    m = onnx.load(src); g = m.graph; inits, casts = [], []
    for t in g.initializer:
        a = numpy_helper.to_array(t)
        if a.dtype == np.float32 and a.size > 16:
            inits.append(numpy_helper.from_array(a.astype(np.float16), t.name + '_h')); casts.append(helper.make_node('Cast', [t.name + '_h'], [t.name], to=TensorProto.FLOAT))
        else: inits.append(t)
    del g.initializer[:]; g.initializer.extend(inits); n = casts + list(g.node); del g.node[:]; g.node.extend(n)
    onnx.checker.check_model(m); onnx.save(m, dst)
    print('wrote', dst, os.path.getsize(dst), 'sha256', hashlib.sha256(open(dst, 'rb').read()).hexdigest())
os.makedirs(OUT, exist_ok=True)
half(enc, os.path.join(OUT, 'mobilesam_encoder.onnx')); half(dec, os.path.join(OUT, 'mobilesam_decoder.onnx'))
for n in ['mobilesam_encoder', 'mobilesam_decoder']:
    open(os.path.join(OUT, n + '.LICENSE.txt'), 'wb').write(open(os.path.join(work, 'LICENSE'), 'rb').read())
