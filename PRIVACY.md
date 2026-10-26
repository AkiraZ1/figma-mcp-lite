# Política de privacidade — figma-mcp-lite

Última atualização: 26 de outubro de 2026

O figma-mcp-lite é um software de código aberto mantido por Jemerson Barros. Esta política explica o que acontece com os seus dados quando você usa o plugin para Claude Code/Cowork e o plugin para o Figma Desktop.

## Resumo

**O mantenedor não coleta, não recebe e não armazena nenhum dado seu.** O plugin não tem servidor na internet, não usa analytics, não envia telemetria e não pede credenciais.

## O que roda e onde

| Componente | Onde roda | Com quem se comunica |
|---|---|---|
| Servidor MCP (`server/server.mjs`) | Na sua máquina, iniciado pelo Claude Code/Cowork | Só com o Claude Code (stdio) e com o plugin do Figma, em `localhost` (portas 3055 e 3056). Recusa conexões vindas de sites |
| Plugin do Figma | Dentro do Figma Desktop | Só com o servidor local, em `localhost:3055` |
| Agente `figma-lite` | No Claude Code/Cowork | Usa as ferramentas acima e, no modo remoto, o conector oficial da Figma |

Nenhum desses componentes acessa a internet.

## Dados gravados

- **No arquivo do Figma** (`sharedPluginData` do documento): um catálogo do design system (nomes, valores e descrições de variáveis, estilos e componentes) e, no modo remoto, o código do builder. Isso fica no próprio arquivo, sujeito às permissões de compartilhamento dele, e serve pra não escanear tudo de novo.
- **Na sua máquina** (`~/.figma-mcp-lite`): guias opcionais extraídos da documentação de bibliotecas, só quando você pede isso.

Nada disso é enviado ao mantenedor.

## Serviços de terceiros

- **Anthropic (Claude):** o que você pede e o que o agente lê do Figma (como o catálogo e a resposta das ferramentas) entram na conversa com o Claude e são tratados conforme a [política de privacidade da Anthropic](https://www.anthropic.com/legal/privacy).
- **Figma:** os seus arquivos continuam sob os [termos](https://www.figma.com/legal/tos/) e a [política de privacidade](https://www.figma.com/legal/privacy/) da Figma. No modo remoto, o agente usa o conector oficial da Figma, autenticado pela sua própria conta. O figma-mcp-lite nunca vê nem guarda essa autenticação.

## Seus controles

- Feche o plugin do Figma (botão **Parar** na notificação) pra interromper a conexão.
- Desinstale o plugin do Claude Code (`/plugin`) e apague `~/.figma-mcp-lite` pra remover tudo da sua máquina.
- Os dados do catálogo no arquivo do Figma ficam no namespace `lite` dos dados de plugin e são substituídos a cada novo escaneamento.

## Contato

jemersonbarros@gmail.com ou https://github.com/AkiraZ1/figma-mcp-lite/issues
