# Instruções para agentes

## Agent skills

### Seleção automática

O usuário descreve o objetivo em linguagem natural; escolha as skills pertinentes sem exigir que ele cite seus nomes. Leia o `SKILL.md` completo de cada skill selecionada antes de aplicar seu fluxo. Ajuste o processo ao tamanho da tarefa.

| Situação | Skills e comportamento |
| --- | --- |
| Funcionalidade substancial ou com requisitos ambíguos | Use `grill-with-docs` para resolver as dúvidas importantes; mantenha termos e decisões com `domain-modeling`. |
| Requisitos resolvidos de uma funcionalidade substancial, ou pedido de especificação | Use `to-spec` para registrar a especificação no rastreador configurado. |
| Plano ou spec acordado com várias entregas | Use `to-tickets` para propor fatias completas e suas dependências; publique a divisão após aprovação do usuário. |
| Implementação de comportamento que exige testes | Use `tdd` com testes proporcionais à mudança e interfaces de teste previamente acordadas. Use `codebase-design` se for necessário decidir essas interfaces. |
| Bug difícil, falha recorrente ou regressão de desempenho | Use `diagnosing-bugs` para reproduzir o sintoma, investigar e verificar a correção. |
| Criação ou reformulação de tela | Use `frontend-design`, respeitando a identidade visual e os componentes existentes. |
| Revisão de alterações de comportamento | Use `code-review` quando houver um diff e requisitos para comparar. Sem histórico Git, revise o escopo conhecido das alterações e declare a limitação da comparação. |
| Pedido de avaliação de arquitetura ou de plano de refatoração | Use `improve-codebase-architecture` para apresentar opções antes de implementar uma delas. |
| Encerramento ou transferência de sessão, ou pedido de checkpoint | Use `handoff` e preserve uma cópia durável conforme as regras abaixo. |

Para correções pequenas e claras, execute diretamente e faça a verificação pertinente. Esclareça apenas decisões ainda abertas; aproveite respostas e aprovações já dadas. Preserve as confirmações exigidas pelos fluxos escolhidos. A seleção automática não amplia o escopo do pedido.

Use `setup-matt-pocock-skills` somente quando o usuário pedir configuração ou mudança do rastreador; o setup deste projeto já foi concluído.

### Checkpoints de sessão

Quando o usuário indicar que quer encerrar ou transferir a sessão (por exemplo, "vamos encerrar por hoje"), ou pedir um checkpoint, use `handoff`. Salve o documento temporário previsto pela skill e copie seu conteúdo para `docs/handoffs/<AAAA-MM-DD-HHMMSS>.md`, com data e hora de São Paulo e nome único.

Registre objetivo da próxima sessão, pendências, bloqueios, verificações realizadas e referências aos artefatos existentes. Remova informações sensíveis e informe o caminho da cópia durável. A conclusão de uma tarefa isolada não caracteriza encerramento de sessão.

Ao retomar um trabalho anterior, leia o checkpoint indicado ou o mais recente relacionado ao assunto e confira o estado atual dos arquivos antes de continuar.

### Issue tracker

Specs e tickets são arquivos Markdown locais em `.scratch/<funcionalidade>/`. Consulte `docs/agents/issue-tracker.md` para caminhos, formato e dependências.

### Domain docs

O projeto usa um único contexto: `GLOSSARY.md` na raiz e decisões em `docs/adr/`. Consulte `docs/agents/domain.md` para as regras de leitura e manutenção.

### Publicação no GitHub

Por instrução do usuário, após implementar e validar alterações deste projeto, faça commit e push para o repositório GitHub correto. A publicação faz parte da entrega, sem pedir nova autorização a cada alteração. Verifique o destino e preserve alterações remotas; não use force push nem inclua bancos, documentos, backups, credenciais ou artefatos temporários de teste. Informe o commit enviado. Se o destino ou o acesso estiver indisponível, explique o impedimento e peça somente a informação necessária; não apresente uma alteração local como publicada.

O serviço do servidor chama-se `PautaTecnica`; o comando de reinício é `nssm restart PautaTecnica`. No PowerShell do servidor, use `npm.cmd` porque a política de execução bloqueia `npm.ps1`.

Repositório confirmado: https://github.com/isaacisl/pauta-tecnica-congresso, branch master. A cópia Git de publicação fica em .tmp-ui-check/publish-github/. Confira o estado remoto antes de sincronizar os arquivos locais e publicar; a raiz atual do projeto não possui pasta .git.
