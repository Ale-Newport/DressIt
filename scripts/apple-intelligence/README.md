# Pruebas de Apple Intelligence y Vision en el Mac

Scripts con los que se evaluó, antes de integrarlo en la app, el modelo de Apple que corre en el
dispositivo (Foundation Models) y el recorte de sujeto de Vision. Usan el mismo modelo que un iPhone
con Apple Intelligence, ejecutado en el Mac (macOS 27 con Apple Intelligence activado).
Resultados: [docs/evidence/apple-intelligence-2026-11-24.md](../../docs/evidence/apple-intelligence-2026-11-24.md).

Generar el vocabulario (ids de ocasiones y prendas) a partir de `packages/shared`:

```bash
node -e "import('./packages/shared/src/vocabulary.ts').then(v=>{const q=a=>'['+a.map(x=>JSON.stringify(x)).join(', ')+']';console.log('let SUBS = '+q(v.SUBCATEGORIES.map(s=>s.id)));console.log('let OCCS = '+q(v.OCCASIONS.map(o=>o.id)));console.log('let PATS = '+q(v.PATTERNS.map(p=>p.id)));console.log('let MATS = '+q(v.MATERIALS.map(p=>p.id)))})" > /tmp/vocab.swift
```

Lectura de peticiones del asistente (12 frases de ejemplo):

```bash
swiftc -O -parse-as-library scripts/apple-intelligence/intent-probe.swift /tmp/vocab.swift -o /tmp/intent-probe && /tmp/intent-probe
```

Descripción de fotos de prendas (necesita macOS 27 o iOS 27 para imágenes):

```bash
cat /tmp/vocab.swift scripts/apple-intelligence/describe-probe.swift > /tmp/main.swift && swiftc -O /tmp/main.swift -o /tmp/describe-probe && /tmp/describe-probe foto1.jpg foto2.jpg
```

Recorte de sujeto con Vision (escribe PNG en `./lift/`):

```bash
mkdir -p lift && swiftc -O scripts/apple-intelligence/lift-probe.swift -o /tmp/lift-probe && /tmp/lift-probe foto1.jpg foto2.jpg
```
