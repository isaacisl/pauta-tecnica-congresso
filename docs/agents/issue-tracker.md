# Rastreador de tarefas: Markdown local

Specs e tickets deste projeto são arquivos Markdown dentro de `.scratch/`.

## Convenções

- Cada funcionalidade usa `.scratch/<funcionalidade>/`, com um nome curto separado por hífens.
- A especificação fica em `.scratch/<funcionalidade>/spec.md`.
- Cada ticket fica em `.scratch/<funcionalidade>/issues/<NN>-<nome>.md`, numerado a partir de `01`, em ordem de dependência.
- Grave um arquivo por ticket; não agrupe todos em um documento único.
- Tickets devem descrever o comportamento entregue e critérios de aceite verificáveis.
- Registre `Blocked by:` com os números/títulos dos tickets necessários, ou `None (can start immediately)`.
- Registre `Status:` perto do início de cada ticket. Os tickets publicados por `to-tickets` começam com `ready-for-agent`.
- Comentários e histórico de conversa são acrescentados ao final do arquivo, sob `## Comments`.

## Publicar e consultar

Quando uma skill disser para publicar no rastreador, crie ou atualize os arquivos locais correspondentes. Para consultar um ticket ou spec, leia o arquivo indicado, incluindo comentários.

Antes de publicar uma divisão em tickets, apresente a proposta e suas dependências para aprovação do usuário, conforme a skill `to-tickets`.

## Executar

Trabalhe em tickets cujos bloqueadores já estejam concluídos. Atualize o status e registre o resultado e a verificação no próprio ticket. Não encerre nem altere automaticamente um ticket pai.
