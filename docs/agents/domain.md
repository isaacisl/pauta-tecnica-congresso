# Documentação de domínio

Este projeto usa um único contexto de domínio.

## Antes de explorar uma área

- Leia `GLOSSARY.md` na raiz, quando existir.
- Leia as decisões em `docs/adr/` relacionadas à área que será alterada, quando existirem.
- Se esses arquivos não existirem, continue o trabalho normalmente. Não crie documentos vazios apenas para preencher a estrutura.

## Criação e manutenção

A skill `domain-modeling`, usada por `grill-with-docs` e `improve-codebase-architecture`, cria o glossário e as decisões quando termos ou escolhas forem resolvidos.

- `GLOSSARY.md` registra os conceitos do domínio e seus significados, sem detalhes de implementação.
- Decisões de arquitetura ficam em `docs/adr/`, com nomes numerados, por exemplo `0001-descricao-da-decisao.md`.
- Registre decisões que envolvam alternativas reais, custo relevante de reversão e contexto necessário para futuros leitores.
- Não invente justificativas para escolhas antigas. Consulte o código e confirme o contexto com o usuário quando necessário.

## Vocabulário e conflitos

Use os termos definidos no glossário em specs, tickets, testes e propostas. Evite sinônimos que mudem seu significado. Quando houver uma lacuna ou ambiguidade, esclareça-a com `domain-modeling`.

Se uma proposta contrariar uma decisão existente, indique explicitamente o ADR afetado e a razão para reconsiderá-lo antes de substituí-lo.
