# Exemplos de uso — figma-mcp-lite

Um exemplo por ferramenta, sempre no formato em lote quando há mais de um item. Esta página é pra quem desenvolve ou quer entender o plugin. Ela **não** entra no contexto do agente: o agente vê só as descrições curtas das ferramentas e pede os detalhes com `figma_help`.

Regra de ouro: **uma chamada por tipo de operação**. Vários itens vão numa lista só, e uma chamada individual fica só pra quando o lote falhar.

## figma_status
```json
{}
{ "file": "Untitled" }            // quando o plugin está aberto em mais de um arquivo
```

## figma_ds — catálogo do design system
```json
{ "filter": "bg/neutral|text/|border/|padding|gap|radius|heading|body" }
{ "filter": "bg/accent" }          // grupo grande resumido: peça pelo nome pra ver os valores
{ "refresh": true }                // só se o DS do arquivo mudou
```

## figma_build — telas inteiras numa chamada
```json
{ "specs": [
  { "spec": { "frame": "Login", "w": 390, "fill": "$bg/neutral/default", "pad": ["$padding/2x-large", "$padding/x-large"], "gap": "$gap/medium",
      "children": [
        { "text": "Entrar", "type": "text/heading/xl", "color": "$text/neutral/primary" },
        { "text": "Acesse sua conta", "type": "text/body/md", "color": "$text/neutral/secondary" } ] } },
  { "spec": { "frame": "Card", "w": 320, "pad": "$padding/small", "r": "$radius/rounded", "fill": "$bg/neutral/subtle" }, "parent": "12:34" }
] }
```

Fundo de partículas, defaults herdados e elipse:
```json
{ "spec": { "frame": "Universo 1", "w": 1440, "h": 900, "layout": "none", "fill": "#05060F", "def": { "abs": true },
  "children": [
    { "scatter": "Stars", "count": 70, "seed": 7, "size": [1, 3], "o": [0.3, 1], "fill": "#FFFFFF" },
    { "ellipse": "Sol", "d": 70, "x": 685, "y": 415, "fill": "#FFC94D" },
    { "ellipse": "Órbita 1", "d": 260, "x": 590, "y": 320, "stroke": "#FFFFFF33", "sw": 1 } ] } }
```

## figma_variant — telas que repetem estrutura (Smart Animate)
```json
{ "source": "Universo 1", "variants": [
  { "name": "Universo 2", "patches": { "Stars": { "x": -30 }, "Planeta 1": { "x": 700, "y": 300 }, "Conteudo/Titulo": { "text": "Planetas" } } },
  { "name": "Universo 3", "patches": { "Stars": { "x": -60 }, "Planeta 1": { "x": 820, "y": 380 }, "Conteudo/Titulo": { "text": "Estrelas" } } }
] }
```

## figma_edit — ajustes em lote
```json
{ "items": [
  { "path": "Universo 2/Conteudo/*", "patch": { "o": 1 } },
  { "id": "27:600", "patch": { "text": "Galáxias", "type": "text/heading/xl" } },
  { "path": "Login/Botão", "patch": { "fill": "$bg/brand/primary/bold", "r": "$radius/round" } }
] }
```

## figma_link — protótipo
```json
{ "links": [
  { "from": "Universo 1", "to": "Universo 2", "trigger": "delay", "ms": 2000, "animation": "smart", "easing": "EASE_IN_AND_OUT", "duration": 0.8 },
  { "from": "Universo 2", "to": "Universo 3", "trigger": "delay", "ms": 2000, "animation": "smart" },
  { "from": "Login/Botão", "to": "Home", "trigger": "click", "animation": "dissolve" }
] }
```

## figma_edit com animação (Motion) — várias camadas numa chamada
```json
{ "items": [
  { "path": "Universo 1/Conteudo/Titulo", "patch": { "anim": { "keys": { "OPACITY": [[0, 0], [0.4, 1]], "TRANSLATION_Y": [[0, 24], [0.4, 0, "EASE_OUT"]] } } } },
  { "path": "Universo 1/Conteudo/Subtitulo", "patch": { "anim": { "keys": { "OPACITY": [[0, 0], [0.4, 1]] }, "delay": 0.15 } } },
  { "path": "Universo 1/Sol", "patch": { "anim": { "style": "?" } } }
] }
```
`"style": "?"` devolve, nos avisos, a lista de estilos de animação prontos da Figma.

## figma_build / figma_edit com desenho (Draw)
```json
{ "items": [
  { "path": "Universo 1/Órbita 1", "patch": { "brush": "HEIST" } },
  { "path": "Universo 1/Órbita 2", "patch": { "dynamic": { "frequency": 2, "wiggle": 3, "smoothen": 0.5 } } }
] }
```
```json
{ "spec": { "path": "M0 60 C 120 0 240 120 360 60", "n": "Assinatura", "stroke": "#FFFFFF", "sw": 3, "brush": "BIOPIC",
            "onPath": "uma viagem pelo universo", "size": 14, "color": "#FFFFFFCC", "abs": true, "x": 80, "y": 760 }, "parent": "27:564" }
```

## figma_build com ícone e imagem
```json
{ "spec": { "frame": "Perfil", "layout": "H", "gap": 12, "children": [
  { "rect": "Avatar", "d": 48, "r": "$radius/circular", "img": "~/Desktop/foto.jpg", "fit": "fill" },
  { "svg": "<svg viewBox='0 0 24 24'><path d='M12 2l3 7h7l-5.5 4 2 7-6.5-4.5L5.5 20l2-7L2 9h7z'/></svg>", "n": "Ícone estrela", "w": 24, "h": 24, "color": "$icon/brand/primary/default" }
] } }
```

## figma_component — vários numa chamada
```json
{ "items": [
  { "ids": ["30:1", "30:2"], "n": "Botão", "props": { "Rótulo": "TEXT:Comprar" } },
  { "id": "30:5", "n": "Card produto" }
] }
```

## figma_inspect — ler pra código
```json
{ "ids": ["27:564", "27:661"], "depth": 2 }
```

## figma_shot — conferir várias telas numa resposta
```json
{ "ids": ["27:564", "27:661", "27:750", "27:839"], "width": 360 }
```

## figma_tree
```json
{ "id": "27:564", "depth": 2 }
```

## figma_help — vários tópicos de uma vez
```json
{ "topic": "anim,draw" }
```

## Orçamento de tokens (verificado nos testes)
- Ferramentas + instruções do servidor: < 1.400 tokens.
- Cada tópico do `figma_help`: < 300 tokens.
- Prompt do agente + spec: < 2.600 caracteres.
- `figma_build`, `figma_variant` e `figma_link` devolvem só ids e contagens.
