"""Upload scheme tile icons from ./scheme-icons/<category>/<risk>.<ext> to the
Supabase `scheme-icons` bucket, and print the public URL + the SCHEME_META
iconUrl mapping to paste into the frontend.

Layout expected (any image extension: png/jpg/jpeg/webp/svg):
  scheme-icons/land/low.png   land/medium.png   land/high.png
  scheme-icons/flat/...  apartment/...  duplex/...
"""
import os, sys, mimetypes
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
from app.supabase_client import get_supabase

BASE = os.path.join(os.path.dirname(__file__), 'scheme-icons')
CATS = ['land', 'flat', 'apartment', 'duplex']
RISKS = {'low': 'conservative', 'medium': 'balanced', 'high': 'aggressive'}
BUCKET = 'scheme-icons'

def find(cat, risk):
    d = os.path.join(BASE, cat)
    if not os.path.isdir(d): return None
    for f in os.listdir(d):
        stem, ext = os.path.splitext(f)
        if stem.lower() == risk and ext.lower() in ('.png','.jpg','.jpeg','.webp','.svg'):
            return os.path.join(d, f)
    return None

def main():
    sb = get_supabase()
    mapping = {}   # (cat, variant) -> public url
    for cat in CATS:
        for risk, variant in RISKS.items():
            path = find(cat, risk)
            if not path:
                print(f"  [skip] {cat}/{risk} — no image found")
                continue
            ext = os.path.splitext(path)[1].lower()
            key = f"{cat}/{risk}{ext}"
            ctype = mimetypes.guess_type(path)[0] or 'image/png'
            with open(path, 'rb') as fh:
                data = fh.read()
            try:
                sb.storage.from_(BUCKET).upload(key, data,
                    {'content-type': ctype, 'upsert': 'true'})
            except Exception as e:
                # already exists → update
                sb.storage.from_(BUCKET).update(key, data, {'content-type': ctype})
            url = sb.storage.from_(BUCKET).get_public_url(key)
            mapping[(cat, variant)] = url
            print(f"  [ok]   {cat}/{risk:6s} -> {url}")
    print("\n--- paste-ready iconUrl per scheme (property, variant) ---")
    for cat in CATS:
        for variant in ('conservative','balanced','aggressive'):
            u = mapping.get((cat, variant))
            if u: print(f"  {cat:9s} {variant:13s} {u}")

if __name__ == '__main__':
    main()
