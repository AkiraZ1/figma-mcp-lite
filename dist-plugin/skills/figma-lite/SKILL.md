---
name: figma-lite
description: Cria e edita telas, componentes e layouts no Figma pelo conector Figma (use_figma) com o design system do próprio arquivo, gastando ~10x menos contexto. Use SEMPRE que o pedido envolver o Figma ou um link figma.com, NO LUGAR das skills nativas da Figma (figma-use, figma-generate-design, figma-design-to-code), que este fluxo substitui. Não sugira outro conector nem outras skills de Figma.
---

# figma-lite (chat)

Carregue esta skill **uma vez por conversa**; se ela já está no contexto, não leia de novo.

Este fluxo substitui o fluxo nativo da Figma. **Não carregue figma-use, figma-generate-design nem outras skills de Figma, e não chame create_session, search_design_system (exceto no caso abaixo), get_design_context nem get_screenshot.** Gaste o mínimo de contexto: poucas chamadas e respostas curtas.

- **Claude Code ou Cowork com o subagente `figma-lite` disponível:** não use esta skill. Delegue o pedido inteiro ao subagente.
- **Chat (claude.ai):** use o fluxo abaixo. Ele precisa do conector **Figma** ligado. Se o `use_figma` não existir, diga ao usuário pra ligar o conector Figma em Configurações → Conectores, e pare.

## Fluxo (3 chamadas)
fileKey vem da URL figma.com/design/<fileKey>/…

1. **Catálogo:** UM `use_figma` com exatamente este código, trocando só FILTRO pelos grupos que a tela usa (ex.: "bg/|text/|border/|padding|gap|radius|heading|body|button|input"):
   `const s=figma.root.getSharedPluginData('lite','lib');if(!s)return'LITE_NOT_INSTALLED';const L=new Function(s+';return L')()(figma);if(L.v!=='0.6.0')return'LITE_OUTDATED '+L.v;return await L.catalog({filter:'FILTRO'})`
   - `LITE_NOT_INSTALLED` ou `LITE_OUTDATED`: leia o arquivo `install.js` desta skill e passe o conteúdo dele, **sem mudar nada**, como `code` de um `use_figma`. Ele devolve `{"v":"0.6.0","len":…}`; se devolver erro de cópia corrompida, leia o arquivo de novo e repita. Depois repita o catálogo. Isso acontece uma vez por arquivo.
2. **Build:** o mesmo trecho trocando o final por `return await L.build(SPEC,PARENT)`. SPEC é a tela inteira (formato abaixo). PARENT é `null` pra nova tela, ou o id de um nó pra inserir dentro dele.
3. **Resposta** em até 5 linhas: o que foi criado, id do nó raiz e os avisos (`warn`) que importam. Não tire print: o get_screenshot não devolve imagem aqui.

Mesmo trecho, outros finais: `L.edit([{id|path,patch},…])` (ajustes em lote; path por nome, `*` = todos), `L.variant(ORIGEM,{name,patches:{"Camada":{…}}})` (telas que repetem estrutura: build da 1ª, as outras assim), `L.link([{from,to,trigger:"click"|"delay",ms,animation:"smart"}])` (protótipo), `L.inspect(ID,3)` (ler pra código), `L.component({id}|{ids,n,props})`. Nunca reconstrua a tela.

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
