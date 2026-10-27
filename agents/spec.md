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
