# Áreas técnicas dos consultores — novembro/2026

Status: concluído

## Problem Statement

A lista agrupa consultores na área genérica Consultor e ainda vincula Vitória Jadallah a Assistência Social. A CNM informou a nova área Políticas sobre Drogas e forneceu uma planilha com 41 vínculos de 40 consultores.

## Solution

Disponibilizar cada consultor nas áreas confirmadas e transferir também os acompanhamentos antigos. Remover Consultor das opções de novos cadastros, preservando registros e documentos.

## User Stories

1. Como técnico, quero selecionar Políticas sobre Drogas e Vitória Jadallah para cadastrar acompanhamentos da nova área.
2. Como usuário, quero encontrar os consultores nas áreas informadas pela CNM, mantendo os demais colaboradores.
3. Como usuário, quero encontrar Mário Nascimento em Desenvolvimento Rural e Turismo.
4. Como usuário, quero que acompanhamentos antigos de consultores sejam transferidos para as áreas confirmadas.
5. Como usuário, quero preservar os IDs, anexos, classificações, vínculos legislativos e tramitações dos acompanhamentos transferidos.
6. Como usuário, quero reconhecer Nancy Ramos como Nancy de Andrade e Rafael Correa como José Rafael Correa.
7. Como usuário, quero retirar Pedro Passos e Roberto Siegmann das opções novas, preservando eventuais acompanhamentos anteriores.
8. Como responsável pela base, quero consultar o antes/depois das transferências no histórico, sem repeti-las a cada reinício.
9. Como solicitante, quero a relação dos nomes acrescentados e dos nomes antigos ausentes da planilha.

## Implementation Decisions

- Fonte: Consultores CNM - Áreas Técnicas.xlsx, aba Planejamento de 2026, A2:B42, recebida em 11/11/2026. A tabela auxiliar das colunas E:F não define vínculos.
- Correspondências confirmadas: Consórcios Públicos → Consórcios; Finanças → Finanças e Tributação; Jurídico → Jurídico Técnico; Obras → Obras, Transferências e Parcerias; Orçamento Público → Orçamento; Saneamento → Sustentabilidade.
- Acrescentar Previdência e Segurança Alimentar, além de Políticas sobre Drogas.
- Os dois pares de nomes são as mesmas pessoas; usar os nomes da planilha e reconhecer os anteriores como aliases.
- Atualização única e transacional dos acompanhamentos existentes, incluindo a lixeira. Registrar antes/depois, avançar a revisão para proteger formulários antigos e preservar as datas de inclusão.
- Não apagar nem unir registros, mesmo que vínculos históricos convirjam; a prevenção de novas duplicidades permanece ativa.
- Não escolher arbitrariamente uma das duas áreas de Mário em um eventual acompanhamento histórico fora dessas áreas. Preservar e sinalizar a pendência. A inspeção local não encontrou acompanhamentos de Mário.
- Preservar vínculos antigos dos responsáveis retirados das opções novas, sem disponibilizá-los para novos cadastros.
- Executar backup completo antes de reiniciar a instalação local com a migração.

## Testing Decisions

Interfaces aprovadas pelo usuário em 11/11/2026: listas públicas de seleção e API de cadastro/edição em bases temporárias, incluindo preservação de acompanhamentos antigos. Testar opções por área, aliases, rejeição de vínculos incorretos, migração no reinício, histórico, revisão, filtros, totais, lixeira e documentos. Usar os testes de equipe existentes como referência. Consultas externas legislativas não são necessárias para validar esta alteração.

## Out of Scope

Alterar cargos, inferir outras identidades, excluir acompanhamentos/documentos, modificar a planilha fornecida ou atualizar o servidor remoto diretamente.

## Further Notes

Confirmadas as cinco respostas do solicitante: redistribuir também os acompanhamentos antigos, manter Mário nas duas áreas, usar as correspondências propostas e retirar os dois nomes ausentes das opções novas. Base local inicial: 59 registros, 58 ativos, 11 acompanhamentos de consultores ativos, nenhum acompanhamento de Vitória, Pedro Passos ou Roberto Siegmann.

## Resultado — 11/11/2026

- Todos os 41 vínculos de 40 consultores conferidos contra a planilha original; sete pessoas acrescentadas e duas retiradas das opções novas.
- 107 testes aprovados e verificação de sintaxe concluída. Revisões de padrões e requisitos sem pendências após corrigir a sinalização de área ambígua e versionar os módulos do navegador.
- Backup completo antes da migração local. Onze acompanhamentos atualizados (dez mudanças de área e uma padronização de nome na mesma área), com antes/depois no histórico e revisão avançada uma vez.
- Comparação integral antes/depois: 59 registros, 58 ativos, demais campos e tabelas preservados, 14 documentos com hashes idênticos e integridade SQLite aprovada.
- Navegador conferido: Vitória em Políticas sobre Drogas; Nancy de Andrade em Previdência; área Consultor ausente das opções novas. Nenhum cadastro adicional foi gravado na conferência.
- Servidor local reiniciado e saudável. A implantação no servidor remoto requer atualização do código e reinício do serviço PautaTecnica, com backup prévio.
