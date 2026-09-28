from pathlib import Path
from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parent.parent
target = root / "models" / "vjepa2-vitl"
model_id = "facebook/vjepa2-vitl-fpc64-256"

target.mkdir(parents=True, exist_ok=True)
print(f"Downloading {model_id} for offline use…", flush=True)
snapshot_download(
    repo_id=model_id,
    local_dir=str(target),
    allow_patterns=["config.json", "model.safetensors", "video_preprocessor_config.json"],
)
(target / "READY.json").write_text(
    '{\n  "modelId": "facebook/vjepa2-vitl-fpc64-256",\n  "dtype": "fp16-on-mps/fp32-on-cpu"\n}\n'
)
print(f"Model ready at {target}", flush=True)
