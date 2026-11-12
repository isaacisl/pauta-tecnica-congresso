# Atualizações pendentes em destaque

Status: concluído

## Problem Statement

O ponto vermelho atual é discreto e as novidades podem ficar em páginas posteriores da lista. O usuário precisa localizar os acompanhamentos com novas tramitações e priorizar a leitura.

## Solution

Destacar as linhas com um selo textual de novas tramitações, oferecer filtro de atualizações pendentes combinado com os demais filtros e abrir a lista com as novidades primeiro. Conforme ajuste solicitado em 12/11/2026, não apresentar card de resumo nem botão acima dos filtros.

## User Stories

1. Como usuário, quero perceber imediatamente que há acompanhamentos com atualizações pendentes.
2. Como usuário, quero identificar os acompanhamentos com novidades na própria lista.
3. Como usuário, quero usar Atualizações → Pendentes para exibir apenas acompanhamentos com pendências, preservando área, responsável e demais filtros.
4. Como usuário, quero remover somente esse filtro e voltar aos outros resultados sem perder a seleção anterior.
5. Como usuário, quero identificar cada acompanhamento com um selo textual e a quantidade de novas tramitações.
6. Como usuário, quero abrir os detalhes pelo selo para ler as movimentações oficiais.
7. Como usuário, quero que pendências sejam exibidas primeiro, das detectadas mais recentemente para as mais antigas, antes da paginação.
8. Como usuário, quero continuar escolhendo as classificações por data de inclusão e edição.
9. Como usuário, quero combinar o filtro de atualizações com todos os filtros e com a busca textual.
10. Como usuário, quero que a exportação corresponda aos acompanhamentos filtrados.
11. Como usuário, quero que marcar como visto remova o destaque e retire aquele acompanhamento do filtro de pendentes, mantendo a pendência de outros acompanhamentos.
12. Como usuário, quero receber a lista e as opções atualizadas nas verificações periódicas da página.
13. Como usuário de teclado ou celular, quero acessar as mesmas informações e ações sem depender apenas da cor.

## Implementation Decisions

- Atualização significa tramitação detectada ainda não marcada como vista. Confirmação compartilhada por acompanhamento, sem alterar a classificação Alta/Média/Baixa/N/I.
- Reutilizar os eventos e o cursor de leitura existentes. Nenhuma migração ou mudança nos dados salvos é necessária.
- Filtro Atualizações com opção Pendentes na aba Registros, compatível com os componentes de checkboxes, chips ativos e Limpar filtros existentes.
- A API de listagem mantém o número de acompanhamentos pendentes dentro dos demais critérios por compatibilidade. A interface concentra o destaque nas próprias linhas, sem card de resumo acima dos filtros.
- O mesmo predicado deve servir à lista, às opções, aos totais consultados pela API e à exportação, respeitando as fontes monitoráveis e a lixeira.
- A classificação inicial Atualizações primeiro agrupa pendências e usa a detecção mais recente; empates e resultados sem pendências seguem inclusão mais recente e ID. Não usar a data de última edição como indicação de novidade legislativa.
- Manter as quatro classificações por data disponíveis. Ordenar o conjunto inteiro antes de paginar.
- Após confirmar leitura, recarregar lista/opções/contador e totais, evitando manter uma linha já vista no filtro. Uma nova tramitação posterior à confirmação continua pendente.
- Versionar os arquivos alterados para evitar módulos antigos no cache. Identificar o suporte do servidor pela saúde da API para não apresentar filtros novos com um backend antigo.

## Testing Decisions

Interfaces aprovadas pelo solicitante: filtro pela API e exportação, ordenação/paginação e fluxo visual de leitura em bases temporárias. Cobrir combinações, contagem sem duplicar acompanhamentos por eventos, fontes inválidas, lixeira, confirmação por acompanhamento e novas pendências. Os testes existentes de tramitações, filtros e classificação são a referência. Inspecionar navegador em desktop e celular; não confirmar avisos reais durante a verificação.

## Out of Scope

Alterar a periodicidade de consultas, atualizar automaticamente a situação salva, mudar a prioridade técnica do registro, introduzir leitura por usuário, filtrar avisos já vistos, criar notificações por e-mail ou mudar a tela de Totalização.

## Further Notes

Requisitos e interfaces de teste aprovados pelo usuário em 11/11/2026. Na inspeção inicial havia quatro acompanhamentos com pendências, referentes a duas matérias. Preservar esses avisos na base real.

## Direção visual

Manter a identidade CNM: azul institucional #004587, texto #192f46, branco #ffffff e superfície #f3f6fa. Concentrar a atenção nas linhas destacadas em âmbar discreto e no selo textual clicável. Usar Inter, os tamanhos e controles existentes, sem animação contínua, com foco visível e adaptação para celular.

## Resultado — 11/11/2026

- 110 testes aprovados e verificação de sintaxe concluída.
- Testes da API cobrem filtro combinado, exportação, contagem por acompanhamento, confirmação parcial concorrente, lixeira, histórico de base e identificadores não monitoráveis.
- Navegador conferido em base temporária: selo abre detalhes; confirmação remove somente o acompanhamento lido; contador e opções se ajustam; filtro combinado retorna estado vazio e Exibir todos preserva a área. Interface conferida em desktop, 390 e 320 pixels sem estouro dos novos controles.
- Revisão de Padrões: sem achados acionáveis. Revisão de Spec: sem achados acionáveis. Comparação limitada ao escopo local conhecido contra o commit 4934363 na cópia Git de publicação, pois a raiz não possui histórico Git.
- Backup completo realizado antes do reinício local. Comparação integral preservou 59 registros (58 ativos), todos os campos e tabelas, e 14 documentos com hashes iguais. Nenhuma transferência, alteração de prioridade ou confirmação de aviso real ocorreu na verificação.
- Servidor local reiniciado e navegador recarregado: quatro acompanhamentos com pendências aparecem no aviso e nas primeiras linhas da lista. Contador e filtro da API conferidos.

## Ajuste solicitado — 12/11/2026

- Removidos o card acima dos filtros, seu contador e os botões Ver atualizados/Exibir todos, incluindo as referências e estilos exclusivos.
- Mantidos os destaques das linhas, selos clicáveis, filtro Atualizações → Pendentes e classificação Atualizações primeiro.
- Versões dos arquivos do navegador atualizadas para invalidar cache. Página local recarregada e conferida: card ausente, quatro linhas com pendências continuam destacadas.
- Sintaxe do JavaScript e cinco testes existentes de ordenação/filtro aprovados. Não foram alterados dados nem regras de monitoramento.
