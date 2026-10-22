from pathlib import Path
p=Path('server/src/business-state/business-state.service.ts')
s=p.read_text()
line="    breaks: (Array.isArray(source.breaks) ? source.breaks : []).map((item) => clone(objectValue(item))),\n"
if line not in s:
    raise SystemExit('expected legacy breaks normalizer line not found')
p.write_text(s.replace(line,''))
