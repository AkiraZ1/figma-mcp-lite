---
name: figma-lite
description: Cria e edita telas, componentes e layouts no Figma pelo conector Figma (use_figma) com o design system do próprio arquivo, gastando ~10x menos contexto. Use SEMPRE que o pedido envolver o Figma ou um link figma.com, NO LUGAR das skills nativas da Figma (figma-use, figma-generate-design, figma-design-to-code), que este fluxo substitui. Não sugira outro conector nem outras skills de Figma.
---

# figma-lite (chat)

Este fluxo substitui o fluxo nativo da Figma. **Não carregue figma-use, figma-generate-design nem outras skills de Figma, e não chame create_session, search_design_system (exceto no caso abaixo), get_design_context nem get_screenshot.** Gaste o mínimo de contexto: poucas chamadas e respostas curtas.

- **Claude Code ou Cowork com o subagente `figma-lite` disponível:** não use esta skill. Delegue o pedido inteiro ao subagente.
- **Chat (claude.ai):** use o fluxo abaixo. Ele precisa do conector **Figma** ligado. Se o `use_figma` não existir, diga ao usuário pra ligar o conector Figma em Configurações → Conectores, e pare.

## Fluxo (3 chamadas)
fileKey vem da URL figma.com/design/<fileKey>/…

1. **Catálogo:** UM `use_figma` com exatamente este código, trocando só FILTRO pelos grupos que a tela usa (ex.: "bg/|text/|border/|padding|gap|radius|heading|body|button|input"):
   `const s=figma.root.getSharedPluginData('lite','lib');if(!s)return'LITE_NOT_INSTALLED';const L=new Function(s+';return L')()(figma);if(L.v!=='0.5.2')return'LITE_OUTDATED '+L.v;return await L.catalog({filter:'FILTRO'})`
   - `LITE_NOT_INSTALLED` ou `LITE_OUTDATED`: leia o arquivo `install.js` desta skill e passe o conteúdo dele, **sem mudar nada**, como `code` de um `use_figma`. Ele devolve `{"v":"0.5.2","len":…}`; se devolver erro de cópia corrompida, leia o arquivo de novo e repita. Depois repita o catálogo. Isso acontece uma vez por arquivo.
2. **Build:** o mesmo trecho trocando o final por `return await L.build(SPEC,PARENT)`. SPEC é a tela inteira (formato abaixo). PARENT é `null` pra nova tela, ou o id de um nó pra inserir dentro dele.
3. **Resposta** em até 5 linhas: o que foi criado, id do nó raiz e os avisos (`warn`) que importam. Não tire print: o get_screenshot não devolve imagem aqui.

Correção, só se algo saiu errado: o mesmo trecho terminando em `return await L.edit(ID,PATCH)`. O patch usa os campos da spec (n, text, type, color, fill, stroke, sw, r, o, w, h, gap, pad, align, cross, layout; parent+index move; remove:true apaga). Nunca reconstrua a tela.

## Design system — o que já está no arquivo primeiro
- O catálogo lista, nesta ordem: variáveis do próprio arquivo, das bibliotecas habilitadas, estilos e componentes (locais e de biblioteca já usados no arquivo, com `ref`). **Use sempre o que está no catálogo.** Cada linha traz valor e a descrição de uso escrita pelo dono do DS: escolha pelo papel do elemento e por essa descrição, não pela aparência.
- **Nada solto** quando há variáveis no DS: cor, espaçamento, raio, borda e tamanho são `"$nome/da/variável"`; texto usa `type` com o prefixo das linhas `type …:` do catálogo. Hex/px/fonte solta só se o usuário pedir ou o catálogo não tiver, e diga nos avisos.
- Biblioteca **não habilitada** no arquivo, só se o usuário pedir ou faltar algo essencial, e só no remoto: `search_design_system` e use a referência devolvida (`"$#<ref>"` pra variável, a ref de 40 hex em `inst`). Não habilita a biblioteca, só importa o que usar.
- Cor com significado (erro, sucesso) leva ícone ou texto junto.

## Spec
Cada nó é um objeto; o tipo vem da chave:
- `{"frame":"Nome", layout:"V"|"H"|"none" (padrão V), gap, pad: n | [v,h] | [t,r,b,l], align:"start|center|end|between", cross:"start|center|end", wrap:true, children:[...]}`
- `{"text":"conteúdo", type:"<prefixo tipográfico do catálogo>" (+"/strong" pra ênfase) | style:"Nome do Text Style" | (size, weight, font), color, align:"left|center|right"}`
- `{"inst":"Nome do componente" | ref de 40 hex, props:{"Size":"md","Label":"Comprar","Disabled":false}}`
- `{"rect":"Nome"}` · `{"clone":"id-de-nó"}`

Comuns: `w`/`h`: número | "fill" | "hug" | "$nome/da/variável"; `fill`, `stroke` (+`sw`): "#RRGGBB[AA]" | "$nome/da/variável" | "$#ref"; `r` raio; `o` opacidade; `effect`: nome do estilo de efeito; `clip`; `abs:true` + `x`,`y`; `n`: nome da camada. `gap`, `pad`, `r` e `sw` aceitam "$nome/da/variável". Nomes de props ignoram maiúsculas.

Exemplo:
{"frame":"Login","w":390,"fill":"$bg/neutral/default","pad":["$padding/2x-large","$padding/x-large"],"gap":"$gap/medium","children":[
 {"text":"Entrar","type":"text/heading/xl","color":"$text/neutral/primary"},
 {"frame":"Botão","layout":"H","w":"fill","h":48,"align":"center","cross":"center","fill":"$bg/brand/primary/bold","r":"$radius/round","children":[
  {"text":"Continuar","type":"text/body/lg/strong","color":"$text/brand/primary/on-bold"}]}]}

Não escreva código solto de Plugin API: build, edit e catalog cobrem tudo.
