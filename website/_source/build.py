#!/usr/bin/env python3
"""Build TheDigiCiti website from the design handoff.

The handoff (`_source/design/*.dc.html`) is the source of truth: inline-styled
markup with {{ holes }}, <sc-if>/<sc-for>/<dc-import>/<x-import> and a
`class Component` whose renderVals() fills the holes. This script compiles each
file into an ES module (`dc/<name>.js`) that renders with Preact through
`dc/rt.js`, and writes one static HTML page per screen. No in-browser compiler,
no React/Babel from a CDN — the browser loads plain JS.

    python3 _source/build.py        # from website/ ; rewrites dc/ and the *.html pages
"""
import html
import json
import re
import shutil
from html.parser import HTMLParser
from pathlib import Path

SRC = Path(__file__).resolve().parent
DESIGN = SRC / 'design'
OUT = SRC.parent
DC = OUT / 'dc'

# Page files and the root component each one mounts.
PAGES = {
    'index.html': 'thedigiciti_website',
    'story.html': 'story',
    'story-1-journey.html': 'story-1-journey',
    'story-2-map.html': 'story-2-map',
    'story-3-numbers.html': 'story-3-numbers',
    'calculator.html': 'calculator',
}
TITLES = {
    'thedigiciti_website': 'TheDigiCiti — a villa in India that pays you rent',
    'story': 'TheDigiCiti · The NRI story',
    'story-1-journey': 'TheDigiCiti · The journey',
    'story-2-map': 'TheDigiCiti · Reading the map',
    'story-3-numbers': 'TheDigiCiti · Your numbers',
    'calculator': 'TheDigiCiti · Calculator',
}
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}
EVENT_MAP = {'onclick': 'onClick', 'onchange': 'onChange', 'oninput': 'onInput', 'onsubmit': 'onSubmit',
             'onkeydown': 'onKeyDown', 'onkeyup': 'onKeyUp', 'onkeypress': 'onKeyPress',
             'onmousedown': 'onMouseDown', 'onmouseup': 'onMouseUp', 'onmouseenter': 'onMouseEnter',
             'onmouseleave': 'onMouseLeave', 'onfocus': 'onFocus', 'onblur': 'onBlur'}
SKIP_HELMET_SRC = ('_ds_bundle.js',)       # React component bundle — replaced by rt.DSButton
HOLE = re.compile(r'\{\{([\s\S]+?)\}\}')
ATTR = re.compile(r'''([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?''')


def rewrite_urls(s: str) -> str:
    """Prototype links → the built pages."""
    s = s.replace('thedigiciti_website.dc.html', 'index.html')
    return re.sub(r'([A-Za-z0-9_-]+)\.dc\.html', r'\1.html', s)


# ── parse (keeps attribute case: viewBox, onClick, …) ─────────────────────────
class Node:
    def __init__(self, tag, attrs=None):
        self.tag, self.attrs, self.children = tag, attrs or [], []


class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#root')
        self.stack = [self.root]

    def _attrs(self):
        raw = self.get_starttag_text()
        body = re.sub(r'^<\s*[^\s>/]+', '', raw)
        body = re.sub(r'/?>$', '', body)
        out = []
        for m in ATTR.finditer(body):
            name = m.group(1)
            val = next((g for g in m.groups()[1:] if g is not None), None)
            out.append((name, html.unescape(val) if val is not None else ''))
        return out

    def _tag(self, tag):
        """The tag as written (SVG needs linearGradient, clipPath, feGaussianBlur …)."""
        m = re.match(r'<\s*([^\s>/]+)', self.get_starttag_text())
        return m.group(1) if m and m.group(1).lower() == tag else tag

    def handle_starttag(self, tag, _a):
        n = Node(self._tag(tag), self._attrs())
        self.stack[-1].children.append(n)
        if tag not in VOID:
            self.stack.append(n)

    def handle_startendtag(self, tag, _a):
        self.stack[-1].children.append(Node(self._tag(tag), self._attrs()))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag.lower() == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def parse(src: str) -> Node:
    p = Parser()
    p.feed(src)
    p.close()
    return p.root


# ── emit ─────────────────────────────────────────────────────────────────────
def js(s) -> str:
    return json.dumps(s, ensure_ascii=False)


def camel(s: str) -> str:
    return re.sub(r'-([a-z])', lambda m: m.group(1).upper(), s)


def mod_id(name: str) -> str:
    return 'C_' + re.sub(r'\W', '_', name)


class Compiler:
    def __init__(self, name):
        self.name = name
        self.imports = set()
        self.pseudo = []          # (class, pseudo, css)
        self.uses_ds_button = False

    def attr_value(self, raw: str) -> str:
        whole = re.fullmatch(r'\s*\{\{([\s\S]+?)\}\}\s*', raw)
        if whole:
            return f'R(v,{js(whole.group(1))})'
        if '{{' in raw:
            return f'J(v,{js(HOLE.split(raw))})'
        return js(raw)

    def pseudo_class(self, pseudo: str, css: str) -> str:
        decls = [d.strip() for d in css.split(';') if d.strip()]
        decls = [d if re.search(r'!\s*important$', d, re.I) else d + ' !important' for d in decls]
        cls = f'p-{re.sub(r"[^a-z0-9]", "", self.name.lower())}-{len(self.pseudo) + 1}'
        self.pseudo.append((cls, pseudo, ';'.join(decls)))
        return cls

    def children(self, node: Node):
        out = []
        for c in node.children:
            e = self.node(c)
            if e is not None:
                out.append(e)
        return out

    def node(self, n):
        if isinstance(n, str):
            if '{{' not in n:
                if not n.strip() and ' ' not in n:
                    return None
                return js(n)
            return f'...T(v,{js(HOLE.split(n))})'
        tag = n.tag
        if tag in ('helmet',):
            return None
        a = dict(n.attrs)
        if tag == 'sc-if':
            kids = self.children(n)
            return f'(R(v,{js(HOLE.sub(lambda m: m.group(1), a.get("value", "")))}) ? [{", ".join(kids)}] : null)'
        if tag == 'sc-for':
            as_ = a.get('as', 'item')
            lst = HOLE.sub(lambda m: m.group(1), a.get('list', ''))
            kids = self.children(n)
            return (f'...((L => Array.isArray(L) ? L : [])(R(v,{js(lst)})).map((it, i) => '
                    f'(v => [{", ".join(kids)}])({{...v, {js(as_)}: it, $index: i}})))')
        if tag == 'dc-import':
            comp = a.get('name') or a.get('component')
            self.imports.add(comp)
            props = []
            for k, val in n.attrs:
                if k in ('name', 'component', 'hint-size') or k.startswith('hint-'):
                    continue
                if k == 'style':
                    props.append(f'__hostStyle: hostStyle({self.attr_value(val)})')
                    continue
                props.append(f'{js(camel(k) if "-" in k else k)}: {self.attr_value(val)}')
            return f'h({mod_id(comp)}, {{{", ".join(props)}}})'
        if tag == 'x-import':
            g = a.get('component-from-global-scope', '')
            if not g.endswith('.Button'):
                raise SystemExit(f'{self.name}: unsupported x-import {g}')
            self.uses_ds_button = True
            props = []
            for k, val in n.attrs:
                if k in ('component-from-global-scope', 'hint-size'):
                    continue
                if k.startswith('aria-') or k.startswith('data-'):
                    key = k
                else:
                    key = camel(k) if '-' in k else k
                props.append(f'{js(key)}: {self.attr_value(val)}')
            kids = self.children(n)
            return f'h(DSButton, {{{", ".join(props)}}}, {", ".join(kids)})'
        # plain DOM element
        props, classes = [], []
        for k, val in n.attrs:
            if k.startswith('style-'):
                classes.append(self.pseudo_class(k[6:], val))
                continue
            key = k
            if key == 'class':
                classes.append(None)  # merged below
                props.append(f'"class": {self.attr_value(val)}')
                continue
            if key == 'for':
                key = 'htmlFor'
            elif key.lower().startswith('on') and len(key) > 2:
                key = EVENT_MAP.get(key.lower(), 'on' + key[2].upper() + key[3:])
            value = self.attr_value(val)
            if key == 'style':
                value = f'S({value})'
            if key in ('value', 'checked') and value.startswith('R('):
                value = f'(x => x === undefined ? {"false" if key == "checked" else js("")} : x)({value})'
            props.append(f'{js(key)}: {value}')
        extra = [c for c in classes if c]
        if extra:
            existing = next((i for i, p in enumerate(props) if p.startswith('"class"')), None)
            if existing is None:
                props.append(f'"class": {js(" ".join(extra))}')
            else:
                props[existing] = props[existing].replace('"class": ', '"class": [', 1) + f', {js(" ".join(extra))}].filter(Boolean).join(" ")'
        kids = self.children(n)
        return f'h({js(tag)}, {{{", ".join(props)}}}{"".join(", " + k for k in kids)})'


def helmet_nodes(root: Node):
    """<helmet> children → [{tag, attrs, text}] (URLs rewritten, DS bundle dropped)."""
    out = []
    xdc = find(root, 'x-dc')
    hel = find(xdc, 'helmet') if xdc else None
    if not hel:
        return out
    for c in hel.children:
        if isinstance(c, str):
            continue
        attrs = {k: rewrite_urls(v) for k, v in c.attrs}
        if c.tag == 'script' and any(s in attrs.get('src', '') for s in SKIP_HELMET_SRC):
            continue
        if c.tag == 'link' and 'fonts.g' in attrs.get('href', ''):
            continue                        # fonts are self-hosted (assets/fonts)
        text = ''.join(x for x in c.children if isinstance(x, str))
        out.append({'tag': c.tag, 'attrs': attrs, 'text': rewrite_urls(text)})
    return out


def find(n: Node, tag: str):
    for c in n.children:
        if isinstance(c, Node):
            if c.tag == tag:
                return c
            r = find(c, tag)
            if r:
                return r
    return None


def compile_file(path: Path) -> dict:
    name = path.name[:-len('.dc.html')]
    src = path.read_text()
    root = parse(src)
    xdc = find(root, 'x-dc')
    script = next((c for c in iter_nodes(root) if c.tag == 'script' and any(k == 'data-dc-script' for k, _ in c.attrs)), None)
    logic = rewrite_urls(''.join(x for x in script.children if isinstance(x, str))) if script else ''
    defaults = {}
    if script:
        raw = dict(script.attrs).get('data-props')
        if raw:
            for k, spec in json.loads(raw).items():
                if not k.startswith('$') and isinstance(spec, dict) and 'default' in spec:
                    defaults[k] = spec['default']
    comp = Compiler(name)
    for i, (k, v) in enumerate(xdc.attrs):
        pass
    # rewrite links inside the template attributes too
    def fix(n):
        for c in n.children:
            if isinstance(c, Node):
                c.attrs = [(k, rewrite_urls(v)) for k, v in c.attrs]
                fix(c)
    fix(xdc)
    kids = comp.children(xdc)
    helmet = helmet_nodes(root)
    lines = ["import { h, R, J, T, S, React, DCLogic, defineDC, addCSS, hostStyle, wheelStepper, bakeFilter, reducedMotion, ready"
             + (", DSButton" if comp.uses_ds_button else "") + " } from './rt.js';"]
    for imp in sorted(comp.imports):
        lines.append(f"import {mod_id(imp)} from './{imp}.js';")
    if comp.pseudo:
        css = '\n'.join(f'.{c}:{p}{{{d}}}' for c, p, d in comp.pseudo)
        lines.append(f'addCSS({js(css)});')
    lines.append('/* ── logic, verbatim from the design file ── */')
    lines.append(logic.strip() or 'class Component extends DCLogic {}')
    lines.append('/* ── template ── */')
    lines.append(f'function tpl(v) {{ return [{", ".join(kids)}]; }}')
    lines.append(f'export const HELMET = {js(helmet)};')
    lines.append(f'export default defineDC({js(name)}, typeof Component !== "undefined" ? Component : null, tpl, {js(defaults)}, HELMET);')
    (DC / f'{name}.js').write_text('\n'.join(lines) + '\n')
    return {'name': name, 'helmet': helmet}


def iter_nodes(n: Node):
    for c in n.children:
        if isinstance(c, Node):
            yield c
            yield from iter_nodes(c)


def head_html(helmet) -> str:
    out = []
    for n in helmet:
        if n['tag'] == 'title':
            continue
        attrs = ''.join(f' {k}="{html.escape(v, quote=True)}"' for k, v in n['attrs'].items())
        if n['tag'] in ('link', 'meta'):
            out.append(f'<{n["tag"]}{attrs}>')
        else:
            out.append(f'<{n["tag"]}{attrs}>{n["text"]}</{n["tag"]}>')
    return '\n'.join(out)


PAGE = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="A villa in India that pays you rent. Built by your SIP, wherever you live.">
<meta name="theme-color" content="#0c0f2c">
<link rel="icon" href="assets/favicon.png">
{preload}
<link rel="stylesheet" href="assets/fonts/fonts.css">
<script>window.__dcStaticHelmet = {root_js};</script>
{head}
<style>html,body{{height:100%;margin:0}}#dc-root,#dc-root>.sc-host{{height:100%}}</style>
<link rel="modulepreload" href="dc/rt.js?v={ver}">
<link rel="modulepreload" href="dc/{root}.js?v={ver}">
</head>
<body>
<div id="dc-root"></div>
<script type="module">
import {{ mount }} from './dc/rt.js?v={ver}';
import Root from './dc/{root}.js?v={ver}';
mount(Root);
</script>
</body>
</html>
'''


def main():
    import hashlib
    if DC.exists():
        shutil.rmtree(DC)
    (DC / 'vendor').mkdir(parents=True)
    shutil.copy(SRC / 'rt.js', DC / 'rt.js')
    shutil.copy(SRC / 'vendor' / 'preact.mjs', DC / 'vendor' / 'preact.mjs')
    info = {}
    for f in sorted(DESIGN.glob('*.dc.html')):
        info[f.name[:-len('.dc.html')]] = compile_file(f)
    # part-transitions.js — shared page-to-page veil (URLs rewritten)
    (OUT / 'part-transitions.js').write_text(rewrite_urls((DESIGN / 'part-transitions.js').read_text()))
    ver = hashlib.sha1(b''.join(p.read_bytes() for p in sorted(DC.glob('*.js')))).hexdigest()[:8]
    # cache-bust the module graph: every import of a sibling carries ?v=
    for p in DC.glob('*.js'):
        t = p.read_text()
        t = re.sub(r"from '\./([\w-]+)\.js'", lambda m: f"from './{m.group(1)}.js?v={ver}'", t)
        t = t.replace("from './vendor/preact.mjs'", f"from './vendor/preact.mjs?v={ver}'")
        p.write_text(t)
    # fonts the first paint needs, by page family; plus the landing's hero art
    pre = {name: f'<link rel="preload" href="assets/fonts/{name}" as="font" type="font/woff2" crossorigin>'
           for name in (SRC.parent / 'assets' / 'fonts' / 'preload.txt').read_text().split()}
    FONTS = {
        'thedigiciti_website': ['Almarai-400-normal-latin.woff2', 'InstrumentSerif-400-italic-latin.woff2', 'Inter-500-normal-latin.woff2', 'Inter-600-normal-latin.woff2'],
        'story': ['Inter-500-normal-latin.woff2', 'Inter-600-normal-latin.woff2', 'Caveat-500-normal-latin.woff2'],
        'story-2-map': ['Inter-500-normal-latin.woff2', 'Inter-600-normal-latin.woff2', 'Caveat-500-normal-latin.woff2'],
    }
    HERO = {'thedigiciti_website': ['assets/explore/villa.webp'], 'story-1-journey': ['assets/explore/villa.webp']}
    for page, root in PAGES.items():
        fonts = FONTS.get(root, ['Inter-400-normal-latin.woff2', 'Inter-500-normal-latin.woff2', 'Inter-600-normal-latin.woff2'])
        preload = '\n'.join([pre[f] for f in fonts if f in pre] + [f'<link rel="preload" href="{u}" as="image" fetchpriority="high">' for u in HERO.get(root, [])])
        (OUT / page).write_text(PAGE.format(title=TITLES[root], root=root, root_js=js(root), preload=preload,
                                            head=head_html(info[root]['helmet']), ver=ver))
    print(f'built {len(info)} components, {len(PAGES)} pages · v={ver}')


if __name__ == '__main__':
    main()
