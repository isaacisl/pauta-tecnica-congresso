# Pauta Técnica

Aplicativo web local para cadastrar e acompanhar projetos prioritários por área técnica. Os dados ficam em uma base SQLite no próprio computador.

## Como executar

Requisito: Node.js 22.5 ou mais recente.

```powershell
npm start
```

Depois, abra [http://127.0.0.1:3000](http://127.0.0.1:3000) no navegador. Para encerrar, pressione `Ctrl+C` no terminal.

## Recursos

- cadastro, edição e exclusão de registros;
- busca obrigatória de novas proposições por tipo, número e ano na Câmara e no Senado, com equivalências oficiais e projeto/ementa automáticos;
- listas de áreas, responsáveis e status baseadas na aba `Parâmetros` da planilha original;
- filtros por área técnica, responsável, parecer, sugestão de emenda e posicionamento;
- busca por projeto, ementa, comissão ou responsável;
- aba de totalização filtrável, com quantidades e percentuais por área e pelos três campos de status;
- exportação protegida por senha da base completa ou filtrada em CSV compatível com Excel;
- anexos opcionais em PDF, documentos do Office, texto ou imagem;
- datas de inclusão e de última edição, além de proteção contra fechamento com alterações não salvas.

## Persistência

A base é criada automaticamente em `data/registros.sqlite`, e os anexos ficam em `data/uploads/`. Ambos são ignorados pelo Git: atualizações de código não substituem esses dados. Para um backup completo, preserve o arquivo SQLite e a pasta de uploads.

## Consulta legislativa e equivalências

No novo cadastro, selecione um dos 12 tipos disponíveis e digite número e ano. A consulta só ocorre ao clicar em **Pesquisar** com os três parâmetros válidos. A pesquisa verifica o cache local e, quando necessário, consulta a Câmara (`/api/v2/proposicoes`) e o Senado (`/dadosabertos/processo?sigla=...&numero=...&ano=...`). As duas Casas são verificadas nas pesquisas ainda não armazenadas para identificar também números coincidentes que correspondam a matérias diferentes. Nenhum registro ou anexo local é enviado às APIs.

Para resultados do Senado, `/dadosabertos/processo/{id}` fornece os vínculos em `identificacaoProcessoInicial`, `idProcessoCasaInicial`, `siglaCasaIniciadora` e `outrosNumeros`. A referência explícita à Câmara é validada pela pesquisa correspondente nessa Casa. Não há comparação por similaridade de ementa ou título. Se a referência não identificar um único ID da Câmara, o sistema informa a ambiguidade e não cria a equivalência.

Um resultado único e sem pendências é selecionado automaticamente; múltiplos resultados exigem escolha. Proposições encontradas somente no Senado ou somente na Câmara também podem ser selecionadas e cadastradas. A confirmação verde informa a(s) fonte(s). Se uma fonte falhar e a outra tiver resultados, há aviso e escolha explícita, sem armazenar a busca parcial no cache. Uma falha no detalhe não esconde dados válidos já retornados pela pesquisa, mas a ausência de informações é sinalizada.

O teste de referência é **PL 3361/2025 (Senado) = PL 7108/2017 (Câmara)**. Os IDs são separados: proposição da Câmara `2125467`, processo no Senado `8862684`, código de matéria do Senado `169542` e processo inicial no sistema do Senado `8862683`. Este último NÃO é um ID da API da Câmara.

Projeto, ementa e apresentação usam a Câmara quando a equivalência é confirmada; em resultados exclusivos do Senado, usam os dados do Senado. Comissão e os demais campos permanecem manuais. A situação vem de `statusProposicao.descricaoSituacao` / `dataHora` na Câmara e `situacaoAtual` / `dataSituacaoAtual` no Senado. Para uma matéria confirmada nas duas Casas (inclusive com a mesma numeração), a situação com data mais recente é destacada, com fonte, identificação e data; as situações de ambas as fontes também ficam disponíveis. A data de atualização geral do processo NÃO substitui a data da situação.

Datas ausentes, empatadas ou sem precisão para comparação (dia inteiro no Senado versus horário nesse mesmo dia na Câmara) exibem as duas situações sem afirmar qual é a mais recente. Código igual sem relação oficial não une matérias: são opções separadas, cada uma com sua situação e fonte. Os detalhes exibem também as identificações equivalentes e os IDs de cada sistema. A pesquisa textual dos registros reconhece ambas as numerações. Todas essas informações são uma fotografia da pesquisa, sem atualização em segundo plano; para atualizar um registro, edite, pesquise e salve novamente (consultas completas podem ser reutilizadas por até 24 horas).

O SQLite tem uma tabela `legislative_matters` com ID interno, ID da Câmara único e opcional, e snapshots separados de cada provedor; `legislative_identifiers` armazena identificações separadas por origem e seus vínculos oficiais; `proposition_search_cache` guarda buscas completas por até 24 horas. Os vínculos permanecem no banco mesmo depois do vencimento do cache. Os registros em `records` apontam para uma matéria por `matter_id`, mantêm o antigo `camara_json` para compatibilidade e salvam a fotografia completa da consulta em `proposition_json`. Uma pesquisa posterior não altera silenciosamente a situação salva em outro registro.

Uma matéria pode receber registros de áreas ou responsáveis diferentes. Um segundo registro para a mesma matéria, área e responsável é bloqueado, inclusive quando pesquisado pela outra numeração. Registros antigos com ID oficial são associados automaticamente à identidade da matéria; registros sem ID não são unificados por texto. Nenhum registro ou anexo antigo é removido. Duplicidades históricas são preservadas e podem continuar sendo editadas.

Se um registro inicialmente exclusivo do Senado receber posteriormente uma equivalência oficial com a Câmara, as identidades são consolidadas em transação. Os registros e anexos existentes são preservados, inclusive eventuais duplicidades históricas. A migração retira a obrigatoriedade do ID da Câmara mantendo os IDs internos e verificando as chaves estrangeiras. Recomenda-se backup do SQLite e dos uploads antes de atualizar o servidor.

Sem uma seleção válida, o novo registro não pode ser salvo. A seleção fica válida por duas horas; se o servidor reiniciar antes de salvar, faça a busca novamente. O servidor precisa de acesso HTTPS a `dadosabertos.camara.leg.br` e `legis.senado.leg.br`.

Os registros anteriores à integração permanecem disponíveis e editáveis sem consulta; para trocar o projeto, é necessário pesquisar. A inicialização acrescenta as novas tabelas e colunas à base existente. Após atualizar o código no servidor, reinicie o serviço NSSM e recarregue o navegador.

### Organização da integração

- `lib/camara.js`: cliente da Câmara e leitura de detalhes.
- `lib/senado.js`: cliente do Senado e extração exclusiva de relações oficiais.
- `lib/propositions.js`: coordenação da pesquisa, escolha, cache e comprovação da seleção.
- `lib/database.js`: persistência das matérias, identificações, registros e cache.
- `server.js`: expõe `/api/propositions` e `/api/propositions/{selectionId}`. A seleção usa `camara-{id}` ou `senado-{id}`, nunca IDs misturados; IDs numéricos e rotas antigas continuam aliases da Câmara.

## Verificação

```powershell
npm run check
npm test
```
