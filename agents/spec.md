## Design system
- Use o que o catálogo lista: variáveis do arquivo e das bibliotecas habilitadas, estilos e componentes (`ref`). Escolha pela descrição de uso de cada linha.
- Nada solto: cor, espaçamento, raio, borda e tamanho como `"$nome/da/variável"`; texto com `type` (prefixo das linhas `type …:`). Valor solto só se faltar no catálogo, e avise.
- Biblioteca não habilitada: só no remoto, via `search_design_system` (`"$#<ref>"` pra variável, ref de 40 hex em `inst`).

## Spec (o tipo vem da chave)
- `{"frame":"Nome", layout:"V"|"H"|"none", gap, pad: n|[v,h]|[t,r,b,l], align:"start|center|end|between", cross, wrap, def:{…props padrão dos filhos}, children:[…]}`
- `{"text":"…", type:"<prefixo>"(+"/strong") | size+weight+font, color, align}` — em coluna de largura fixa já ocupa a largura e quebra linha.
- `{"inst":"Nome"|ref, props:{…}}` · `{"rect":"Nome"}` · `{"ellipse":"Nome","d":70}` · `{"clone":"id"}`
- `{"scatter":"Stars","count":70,"seed":7,"size":[1,3],"o":[0.3,1],"fill":"#FFF","shift":-30}`: N elipses "Star 1..N"; mesmo seed = mesmas posições (Smart Animate); shift = parallax.
- Comuns: `w`/`h`: n|"fill"|"hug"|"$var"; `d` = w e h; `fill`/`stroke`(+`sw`): "#hex"|"$var"; `r`, `o`, `effect`, `clip`, `abs`+`x`,`y`, `n` (nome da camada; sempre vale).
