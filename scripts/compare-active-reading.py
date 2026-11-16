#!/usr/bin/env python3
"""Run retained Release test binaries serially in alternating before/after pairs.

The Rust workload exercises full App::update, atomic storage, actual passage
movement and CPU tessellation. These host timings do not measure phone power,
GPU presentation, refresh pacing or touch latency.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import re
import statistics
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pairs", type=int, default=3)
    parser.add_argument("--memory", action="store_true", help="Record process peak RSS with macOS /usr/bin/time")
    args = parser.parse_args()
    if args.pairs < 3:
        parser.error("Use at least three matched pairs")
    if args.memory and platform.system() != "Darwin":
        parser.error("--memory currently requires macOS")
    import os
    env = dict(os.environ, CROSS_CANON_PERF_LIBRARY=str(args.library.resolve()))
    # This switch disables persistence and would invalidate the workload.
    env.pop("CROSS_CANON_FRESH", None)
    args.output.mkdir(parents=True, exist_ok=True)
    binaries = {"before": args.baseline.resolve(), "after": args.candidate.resolve()}
    runs = {label: [] for label in binaries}
    for pair in range(args.pairs):
        for label in (["before", "after"] if pair % 2 == 0 else ["after", "before"]):
            command = [str(binaries[label]), "performance::active_reading_update_audit",
                       "--exact", "--ignored", "--nocapture", "--test-threads=1"]
            if args.memory:
                command = ["/usr/bin/time", "-l", *command]
            result = subprocess.run(command,
                                    env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            (args.output / f"{label}-{pair + 1}.log").write_text(result.stdout)
            match = re.search(r"ACTIVE_READING_PERF (\{[^\n]+\})", result.stdout)
            if result.returncode or not match or "1 passed; 0 failed" not in result.stdout:
                raise SystemExit(f"Invalid {label} run {pair + 1}: see {args.output}")
            metrics = json.loads(match.group(1))
            if args.memory:
                rss = re.search(r"(\d+)\s+maximum resident set size", result.stdout)
                if not rss:
                    raise SystemExit(f"Missing process peak RSS: see {args.output}")
                metrics["process_peak_resident_bytes"] = int(rss.group(1))
            runs[label].append(metrics)
            print(f"Completed pair {pair + 1}: {label}", flush=True)
    summary = {}
    for metric in runs["before"][0]:
        values = {label: [run[metric] for run in samples] for label, samples in runs.items()}
        before, after = (statistics.median(values[label]) for label in ("before", "after"))
        summary[metric] = {"before": values["before"], "after": values["after"],
                           "before_median": before, "after_median": after,
                           "reduction_percent": 100 * (1 - after / before) if before else None}
    files = {**binaries, "library": args.library.resolve() / "native-library.bin"}
    report = {"host": platform.platform(), "pairs": args.pairs,
              "sha256": {label: hashlib.sha256(path.read_bytes()).hexdigest() for label, path in files.items()},
              "metrics": summary}
    (args.output / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
    for metric, data in summary.items():
        print(f"{metric}: {data['before_median']:.5f} -> {data['after_median']:.5f}")


if __name__ == "__main__":
    main()
