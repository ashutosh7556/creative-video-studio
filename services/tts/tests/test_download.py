import hashlib
import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "download_models.py"
spec = importlib.util.spec_from_file_location("download_models", SCRIPT)
dm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dm)


def test_pins_official_sha256_and_sizes():
    assert dm.FILES["kokoro-v1.0.onnx"] == (
        325_505_369,
        "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a",
    )
    assert dm.FILES["voices-v1.0.bin"] == (
        28_214_398,
        "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    )


def test_is_valid_accepts_matching_file(tmp_path):
    f = tmp_path / "m.bin"
    f.write_bytes(b"hello")
    assert dm.is_valid(f, 5, hashlib.sha256(b"hello").hexdigest())


def test_is_valid_rejects_wrong_size_hash_or_missing(tmp_path):
    f = tmp_path / "m.bin"
    f.write_bytes(b"hellx")
    assert not dm.is_valid(f, 5, hashlib.sha256(b"hello").hexdigest())  # same size, corrupted
    assert not dm.is_valid(f, 6, hashlib.sha256(b"hellx").hexdigest())  # wrong size
    assert not dm.is_valid(tmp_path / "missing.bin", 5, "0" * 64)
