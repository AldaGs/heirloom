// File System Access bits missing from TypeScript's DOM lib (Chromium only).
type FsPermission = { mode?: 'read' | 'readwrite' };
interface FileSystemHandle {
  queryPermission(o?: FsPermission): Promise<PermissionState>;
  requestPermission(o?: FsPermission): Promise<PermissionState>;
}
interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
}
interface Window {
  showDirectoryPicker?(o?: FsPermission): Promise<FileSystemDirectoryHandle>;
}
