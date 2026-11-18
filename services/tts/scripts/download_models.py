"""Downloads Kokoro v1.0 ONNX model files into services/tts/models.

Each file is verified by size and SHA-256 (digests published by GitHub for the
model-files-v1.1 release). Valid existing files are skipped; invalid ones are re-downloaded.
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
FILES = {
    "kokoro-v1.0.onnx": (325_505_369, "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a"),
    "voices-v1.0.bin": (28_214_398, "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"),
}
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def is_valid(path: Path, size: int, sha256: str) -> bool:
    return path.exists() and path.stat().st_size == size and sha256_of(path) == sha256


def download(name: str, size: int, sha256: str) -> None:
    dest = MODELS_DIR / name
    if is_valid(dest, size, sha256):
        print(f"[skip] {name} already present and verified")
        return
    tmp = dest.with_suffix(dest.suffix + ".part")

    def hook(blocks: int, block_size: int, total: int) -> None:
        done = min(blocks * block_size, total or size)
        sys.stdout.write(f"\r[download] {name}: {done / 1e6:6.1f} / {(total or size) / 1e6:.1f} MB")
        sys.stdout.flush()

    urllib.request.urlretrieve(f"{BASE}/{name}", tmp, hook)
    print()
    if not is_valid(tmp, size, sha256):
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"{name}: size or SHA-256 mismatch, download corrupted. Re-run the script.")
    tmp.replace(dest)
    print(f"[ok] {name} verified (sha256 {sha256[:12]}...)")


if __name__ == "__main__":
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for n, (s, h) in FILES.items():
        download(n, s, h)
    print(f"Models ready in {MODELS_DIR}")
