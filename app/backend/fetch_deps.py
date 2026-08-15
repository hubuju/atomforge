# -*- coding: utf-8 -*-
"""Download all backend dependencies without pip's install step.

pip's unpack/target steps hit sandbox permission errors, but plain
urllib + zipfile work fine (verified). This script resolves the full
dependency tree through the Tsinghua PyPI JSON API, downloads every
wheel and unpacks them into a target directory usable via PYTHONPATH.
"""
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

# JSON lookups go to pypi.org (the Tsinghua JSON mirror lags behind and
# resolves to ancient versions); wheel downloads go to the Tsinghua mirror
# whose /packages path mirrors files.pythonhosted.org exactly.
JSON_BASE = "https://pypi.org/pypi/{name}/json"
WHEEL_MIRROR = "https://pypi.tuna.tsinghua.edu.cn"
WHEEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wheels")
TARGET = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "site-pkgs"))
REQ_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")

PLATFORMS = ("cp312-cp312-win_amd64", "cp312-abi3-win_amd64", "py3-none-any", "py2.py3-none-any")


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "atomforge-bootstrap/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


_SEG = re.compile(r"^(\d*)([a-zA-Z]*)(\d*)$")


def parse_version(v):
    # Split "2.0b3" into numeric and alpha segments so that "2.0b3" < "2.0.36"
    # and "2.11.0" hold: pre-release markers rank below their numeric segment.
    out = []
    for p in re.split(r"[.\-_+]", v):
        m = _SEG.match(p)
        if not m:
            out.append((1, p))
            continue
        num, alpha, num2 = m.groups()
        if num:
            out.append((0, int(num)))
        if alpha:
            out.append((1, alpha))
        if num2:
            out.append((0, int(num2)))
    return out


def is_prerelease(version):
    return bool(
        re.search(r"(\d+)(a|b|rc|alpha|beta|pre|dev)\d*", version, re.I)
        or re.search(r"\.dev\d+", version)
    )


def cmp_versions(a, b):
    pa, pb = parse_version(a), parse_version(b)
    for x, y in zip(pa, pb):
        if x != y:
            return -1 if x < y else 1
    return (len(pa) > len(pb)) - (len(pa) < len(pb))


def satisfies(version, spec):
    """Very small PEP 440 subset: comma-separated simple comparisons."""
    for part in [p.strip() for p in spec.split(",") if p.strip()]:
        m = re.match(r"^(<=|>=|==|!=|~=|>|<)\s*([0-9][\w.\-+]*)$", part)
        if not m:
            continue
        op, v = m.group(1), m.group(2)
        c = cmp_versions(version, v)
        if op == "==" and c != 0:
            return False
        if op == "!=" and c == 0:
            return False
        if op == ">=" and c < 0:
            return False
        if op == "<=" and c > 0:
            return False
        if op == ">" and c <= 0:
            return False
        if op == "<" and c >= 0:
            return False
        if op == "~=":
            # ~=X.Y.Z means >=X.Y.Z, ==X.Y.*
            parts = v.split(".")
            if c < 0:
                return False
            if len(parts) >= 2 and parts[-1] != "0" and c > 0:
                prefix = ".".join(parts[:-1])
                if not re.match(rf"^{re.escape(prefix)}\.", version):
                    return False
    return True


def best_wheel(releases, constraint):
    candidate_versions = []
    for version, files in releases.items():
        if not satisfies(version, constraint):
            continue
        for f in files:
            if f.get("packagetype") != "bdist_wheel":
                continue
            fn = f["filename"]
            if any(plat in fn for plat in PLATFORMS):
                candidate_versions.append(version)
                break
    if not candidate_versions:
        return None, None, None
    stable = [v for v in candidate_versions if not is_prerelease(v)]
    pool = stable or candidate_versions
    best = max(pool, key=parse_version)
    for f in releases[best]:
        fn = f["filename"]
        if f.get("packagetype") == "bdist_wheel" and any(plat in fn for plat in PLATFORMS):
            return best, fn, f["url"]
    return None, None, None


def parse_requires_dist(requires_dist):
    deps = []
    for entry in requires_dist or []:
        entry = entry.strip()
        if not entry or "extra ==" in entry or "extra ==" in entry.replace(" ", ""):
            continue
        if ";" in entry:
            entry = entry.split(";", 1)[0].strip()
        m = re.match(r"^([A-Za-z0-9_.\-]+)", entry)
        if m:
            spec = entry[len(m.group(1)):].strip()
            deps.append((m.group(1), spec))
    return deps


def main():
    os.makedirs(WHEEL_DIR, exist_ok=True)
    os.makedirs(TARGET, exist_ok=True)

    with open(REQ_FILE, encoding="utf-8") as fh:
        top = []
        for line in fh:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            m = re.match(r"^([A-Za-z0-9_.\-]+)(.*)$", line)
            if m:
                spec = re.sub(r"^\[[^\]]*\]", "", m.group(2).strip())
                top.append((m.group(1), spec))

    resolved = {}   # name -> (version, filename, url)
    queue = list(top)
    seen = set()

    while queue:
        name, spec = queue.pop(0)
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        try:
            data = fetch_json(JSON_BASE.format(name=name))
        except Exception as exc:
            print(f"[FAIL] lookup {name}: {exc}", flush=True)
            continue
        version, filename, url = best_wheel(data["releases"], spec or "")
        if not url:
            print(f"[FAIL] no wheel for {name} ({spec})", flush=True)
            continue
        resolved[key] = (data["info"]["name"], version, filename, url)
        for dep_name, dep_spec in parse_requires_dist(data["info"].get("requires_dist")):
            if dep_name.lower() not in seen:
                queue.append((dep_name, dep_spec))

    print(f"[INFO] resolved {len(resolved)} packages", flush=True)
    downloaded = []
    for key, (name, version, filename, url) in resolved.items():
        dest = os.path.join(WHEEL_DIR, filename)
        if os.path.exists(dest):
            downloaded.append(dest)
            continue
        real_url = url.replace("https://files.pythonhosted.org", WHEEL_MIRROR)
        try:
            print(f"[GET] {filename}", flush=True)
            req = urllib.request.Request(real_url, headers={"User-Agent": "atomforge-bootstrap/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                content = resp.read()
            with open(dest, "wb") as fh:
                fh.write(content)
            downloaded.append(dest)
        except Exception as exc:
            print(f"[FAIL] download {filename}: {exc}", flush=True)

    print(f"[INFO] unpacking {len(downloaded)} wheels into {TARGET}", flush=True)
    for wheel_path in sorted(downloaded):
        try:
            with zipfile.ZipFile(wheel_path) as zf:
                for member in zf.namelist():
                    if member.startswith((".data/", "__pycache__/")):
                        continue
                    if member.endswith("/"):
                        continue
                    target_path = os.path.join(TARGET, member.replace("/", os.sep))
                    os.makedirs(os.path.dirname(target_path), exist_ok=True)
                    with zf.open(member) as src, open(target_path, "wb") as out:
                        out.write(src.read())
            print(f"[OK] {os.path.basename(wheel_path)}", flush=True)
        except Exception as exc:
            print(f"[FAIL] unpack {wheel_path}: {exc}", flush=True)

    print("DONE", flush=True)


if __name__ == "__main__":
    main()
