# figma-mcp-lite

Monta telas no Figma gastando **~10× menos token** que o fluxo nativo da Figma (MCP oficial + skills), usando o design system que já está no teu arquivo.

| Mesma tela, Sonnet | figma-mcp-lite (plugin) | Figma nativo |
|---|---|---|
| Entrada nova | 9,3k | 98,3k |
| Cache relido | 45k | 570k |
| Tempo | 14s | 76s |

## Como funciona

- Todo trabalho de Figma roda no subagente **`figma-lite`** (Sonnet). A conversa principal não carrega nenhuma ferramenta de Figma: pede, e recebe um resumo de 5 linhas.
- A tela inteira sai de **uma chamada** com uma spec JSON compacta, em vez de dezenas de chamadas montando seção por seção.
- O **catálogo do design system** sai do próprio arquivo: variáveis locais e de todas as bibliotecas habilitadas (com valor e a descrição de uso que o dono do DS escreveu), estilos e componentes. Ele é escaneado uma vez e fica guardado no arquivo.
- Usa **só tokens**: cor, espaçamento, raio, borda e tipografia ficam ligados às variáveis, sem hex nem px soltos.

## Instalação

1. No Claude Code:
   ```
   /plugin install figma-mcp-lite --marketplace AkiraZ1/figma-mcp-lite
   ```
2. Instala o plugin **figma-mcp-lite** no Figma Desktop pela Community: https://www.figma.com/community/plugin/1696575160680183036 (se ele não estiver aberto, o agente te lembra com esse link). Pra desenvolver, dá pra importar o manifest de `plugin/` no repositório.
3. No Figma Desktop, abre o arquivo e roda **Plugins → figma-mcp-lite**. Ele fica em segundo plano, só com um aviso no rodapé ("conectado, rodando em segundo plano"), e tem um botão **Parar**.

Requer Node 20+ (o Claude Code já usa).

## Uso

Pede normalmente, com o link do arquivo:

> cria uma tela de login mobile neste arquivo: https://www.figma.com/design/…

O Claude delega pro `figma-lite`, que:
1. lê o catálogo do DS filtrado só pelo que a tela usa;
2. monta a tela inteira numa chamada;
3. confere com um print;
4. devolve o id do frame e os avisos.

## Sem o plugin do Figma aberto (modo remoto)

Se o conector oficial **Figma** do claude.ai estiver ligado, o agente monta a tela pelos servidores da Figma, sem o plugin. O builder do lite fica instalado no arquivo uma vez (~4k tokens). Custa quase o mesmo em tokens, mas é ~2,5× mais lento e não confere com print.

Deixar o conector ligado custa ~3,6k tokens **em cada turno de qualquer conversa**, mesmo sem usar Figma. Se tu usa o plugin, desliga o conector em `/mcp`.

## Bibliotecas que não estão habilitadas no arquivo

O agente prioriza o que está no arquivo. Se faltar algo, ou se tu pedir uma biblioteca específica, no modo remoto ele busca na biblioteca do time e importa só o que usar, sem habilitar a biblioteca inteira.

## Suporte

Dúvidas, bugs e sugestões: jemersonbarros@gmail.com ou issues em https://github.com/AkiraZ1/figma-mcp-lite/issues

## Termos

Veja os [termos de uso](https://github.com/AkiraZ1/figma-mcp-lite/blob/main/TERMS.md) (licença MIT) e a [política de privacidade](https://github.com/AkiraZ1/figma-mcp-lite/blob/main/PRIVACY.md) (sem coleta de dados).

## Privacidade

O plugin do Figma só conversa com o servidor local (`localhost:3055`). O servidor só escuta na própria máquina e recusa conexões vindas de sites. Nada sai pra internet.
