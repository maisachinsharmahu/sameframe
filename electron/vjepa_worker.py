import argparse
import json
import sys

import av
import numpy as np
import torch
from transformers import AutoModel, AutoVideoProcessor


def sample_frames(video_path: str, count: int = 64):
    container = av.open(video_path)
    try:
        stream = container.streams.video[0]
        duration = container.duration
        if duration is None:
            frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
            if not frames:
                raise ValueError("video has no decodable frames")
            indices = np.linspace(0, len(frames) - 1, count).astype(int)
            return [frames[index] for index in indices]

        timestamps = np.linspace(0, max(0, duration - 1), count).astype(np.int64)
        frames = []
        for timestamp in timestamps:
            container.seek(int(timestamp), any_frame=False, backward=True)
            frame = next(container.decode(stream), None)
            if frame is not None:
                frames.append(frame.to_ndarray(format="rgb24"))
        if not frames:
            raise ValueError("video has no decodable frames")
        while len(frames) < count:
            frames.append(frames[-1])
        return frames[:count]
    finally:
        container.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    request = json.load(sys.stdin)
    paths = request.get("paths", [])

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = torch.float16 if device == "mps" else torch.float32
    processor = AutoVideoProcessor.from_pretrained(args.model, local_files_only=True)
    model = AutoModel.from_pretrained(args.model, local_files_only=True, dtype=dtype).to(device).eval()

    results = []
    for index, video_path in enumerate(paths):
        try:
            frames = sample_frames(video_path)
            inputs = processor(videos=frames, return_tensors="pt")
            pixel_values = inputs["pixel_values_videos"].to(device=device, dtype=dtype)
            with torch.inference_mode():
                output = model(pixel_values_videos=pixel_values)
                vector = output.last_hidden_state.float().mean(dim=1).squeeze(0)
                vector = torch.nn.functional.normalize(vector, dim=0)
            results.append({"path": video_path, "embedding": vector.cpu().tolist()})
        except Exception as error:
            results.append({"path": video_path, "error": str(error)})
        print(json.dumps({"type": "progress", "current": index + 1, "total": len(paths)}), file=sys.stderr, flush=True)
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    main()
