# Pauta Técnica

Aplicativo web local para cadastrar e acompanhar projetos prioritários por área técnica. Os dados ficam em uma base SQLite no próprio computador.

## Consolidação de confiabilidade — outubro/2026

- **Edição concorrente:** registros possuem `revision`. PUT e DELETE exigem a versão aberta pelo usuário (428 se ausente, 409 se desatualizada). O formulário preserva o preenchimento em caso de conflito. Reabra o registro para conferir a versão atual antes de tentar novamente. Envios de documentos também avançam a versão.
- **Lixeira:** excluir agora oculta o acompanhamento da lista, filtros, totais e monitoramento, sem apagar seus documentos. O botão Lixeira permite restaurá-lo. A restauração bloqueia uma duplicidade ativa de matéria + área + responsável. Não há purga automática.
- **Documentos:** na edição de um acompanhamento, cada anexo salvo pode ser removido com confirmação e restaurado em “Documentos removidos”. Arquivos removidos deixam de aparecer entre os ativos e não podem ser baixados, mas permanecem no armazenamento e no backup para permitir restauração. Não há exclusão física automática.
- **Histórico:** a aba Acompanhamento oferece o histórico de inclusão, edição, exclusão e restauração, com antes/depois dos campos. Não se reconstroem alterações anteriores à implantação e, sem login, não se atribui uma pessoa à operação. Documentos mantêm seu histórico próprio.
- **Pesquisa:** o leitor do Senado reconhece também `siglaColegiadoControleAtual`. Na consolidação das Casas, a navegação utiliza a origem **e o ID** da situação vencedora. Homônimos não herdam despacho/comissão de outra matéria.
- **Atualização explícita:** marque “Consultar dados atualizados nas APIs (ignorar cache)” antes de pesquisar. O sistema consulta novamente as fontes, sem atualizar outros acompanhamentos silenciosamente. Ajustes manuais de despacho/comissão exigem confirmação para substituição na mesma matéria.
- **Monitoramento:** os detalhes mostram a última consulta bem-sucedida, primeira verificação pendente, atraso e falha. Um novo vínculo solicita uma verificação próxima ao cadastro; eventos inequivocamente posteriores ao início do acompanhamento não são descartados quando a primeira consulta demora. Datas oficiais sem horário não permitem determinar a ordem dentro do mesmo dia. Registros antigos sem referência inicial continuam usando a primeira consulta como linha de base.
- **Correções de eventos:** Câmara usa a sequência oficial no contexto da proposição; Senado usa o ID do informe. Correções atualizam o texto armazenado sem gerar uma segunda notificação. A migração reconhece o hash antigo da Câmara quando o conteúdo coincide, preservando o ID interno e a leitura. Se a fonte alterar o conteúdo antes dessa primeira conversão, pode haver um aviso adicional na transição; não são apagados avisos antigos.
- **Exportação:** CSV em UTF-8 com BOM para Excel, preservando Unicode e neutralizando células que poderiam virar fórmulas. A senha de exportação continua configurável por `EXPORT_PASSWORD`, com o padrão anterior mantido por compatibilidade. Essa senha protege a exportação, **não** as demais rotas.

Antes de atualizar o servidor, faça backup. Depois do `git pull`, reinicie o serviço NSSM e recarregue os navegadores: formulários de versões antigas não podem sobrescrever registros sem controle de revisão. As migrações são aditivas e preservam registros e anexos; não volte a executar uma versão antiga do servidor sobre a base migrada, pois versões antigas não reconhecem a lixeira nem a remoção de anexos.

### Backup e recuperação

```powershell
npm run backup
# Opcional: informar uma pasta de destino protegida
npm run backup -- D:\Backups\PautaTecnica
```

O comando usa `DATABASE_PATH` quando configurado. Cria um snapshot consistente do SQLite (incluindo transações confirmadas no WAL) e copia todos os documentos referenciados, inclusive da lixeira. O padrão é `data/backups/`, ignorado pelo Git. Só considere completo um diretório com `backup-completo.json`; falta de documento ou falha de integridade interrompe o processo. Copie os backups também para um local protegido fora do disco do servidor e estabeleça retenção conforme a política da empresa.

Para restaurar, pare o serviço, preserve a instalação atual inteira e use o `registros.sqlite` e a pasta `uploads` do mesmo backup em um diretório novo. Aponte `DATABASE_PATH` para esse arquivo e inicie o serviço atualizado. Não misture o snapshot restaurado com arquivos `-wal`/`-shm` de outra base. O teste automatizado de backup verifica reabertura, histórico, lixeira e documentos; também teste a recuperação na infraestrutura do servidor.

### Limites mantidos deliberadamente

Não foram adicionados login, permissões por pessoa ou exclusão automática de registros de teste. O serviço deve permanecer restrito a uma rede confiável/VPN ou a um controle de acesso externo. Proteja a pasta de backups: ela contém toda a base. A paginação continua no navegador; otimização para grandes bases e revisão dos registros sem vínculo oficial são etapas separadas. Não se unem registros antigos apenas por coincidência de nome.

## Como executar

Requisito: Node.js 22.5 ou mais recente.

```powershell
npm start
```

Depois, abra [http://127.0.0.1:3000](http://127.0.0.1:3000) no navegador. Para encerrar, pressione `Ctrl+C` no terminal.

## Recursos

- cadastro, edição e exclusão de registros;
- cadastro em duas etapas: primeiro a busca e os dados do projeto; depois a área, o responsável, a análise e os documentos;
- consulta do registro em abas de projeto e acompanhamento, com edição aberta a partir da aba consultada;
- busca obrigatória de novas proposições por tipo, número e ano na Câmara e no Senado, com equivalências oficiais e projeto, autoria e ementa automáticos; os campos do projeto só aparecem após a seleção de um resultado válido;
- despacho e comissão atual sugeridos automaticamente quando disponíveis, sempre editáveis e opcionais;
- listas de áreas, responsáveis e status baseadas na aba `Parâmetros` da planilha original;
- filtros por área técnica, responsável, parecer, sugestão de emenda e posicionamento;
- busca por projeto, ementa, comissão ou responsável;
- aba de totalização filtrável, com número de projetos distintos e de acompanhamentos, além de quantidades e percentuais por área e pelos três campos de status;
- exportação protegida por senha da base completa ou filtrada em CSV compatível com Excel;
- histórico de múltiplos documentos em PDF, Office, texto ou imagem, com data de inclusão e download individual;
- datas de inclusão e de última edição, além de proteção contra fechamento com alterações não salvas.
- aviso vermelho na lista quando uma nova tramitação oficial é detectada; detalhes da novidade e confirmação manual de que foi vista.

Na totalização, **projetos distintos** usa o ID interno da matéria legislativa quando existe vínculo oficial: várias áreas ou responsáveis acompanhando a mesma matéria contam uma vez, inclusive se Câmara e Senado usam numerações diferentes já vinculadas. Registros antigos sem vínculo oficial são agrupados apenas pelo nome do projeto, ignorando diferenças de maiúsculas e espaços; não se cria equivalência entre matérias diferentes por semelhança de texto. Os filtros afetam ambos os indicadores. As distribuições e percentuais continuam contando acompanhamentos (registros), pois cada área pode ter seu próprio parecer e posicionamento.

## Persistência

A base é criada automaticamente em `data/registros.sqlite`, e os anexos ficam em `data/uploads/`. Ambos são ignorados pelo Git: atualizações de código não substituem esses dados. Para um backup completo e consistente, use `npm run backup`, conforme a seção de recuperação acima.

O campo de documentos fica abaixo de “Há parecer elaborado?”. É possível selecionar vários arquivos (até 20 MB cada), na criação ou na edição. Ao salvar, cada arquivo é acrescentado ao histórico com sua própria data, sem substituir documentos anteriores, mesmo com nomes iguais. O histórico aparece na edição e nos detalhes. Arquivos pendentes podem ser retirados da seleção; documentos já salvos permanecem no histórico. Ao excluir o registro, seus documentos permanecem preservados na lixeira e voltam a ficar disponíveis após a restauração.

Os metadados ficam em `record_attachments`. Na primeira inicialização desta versão, os anexos antigos são migrados automaticamente, mantendo os arquivos em seus locais originais. Como a versão anterior não registrava a data de envio separadamente, esses arquivos mostram “Data de inclusão não registrada”. Os novos documentos recebem a data do servidor. Envios interrompidos podem ser repetidos no mesmo formulário sem duplicar um arquivo já recebido.

## Consulta legislativa e equivalências

No novo cadastro, selecione um dos 12 tipos disponíveis e digite número e ano. A consulta só ocorre ao clicar em **Pesquisar** com os três parâmetros válidos. A pesquisa verifica o cache local e, quando necessário, consulta a Câmara (`/api/v2/proposicoes`) e o Senado (`/dadosabertos/processo?sigla=...&numero=...&ano=...`). As duas Casas são verificadas nas pesquisas ainda não armazenadas para identificar também números coincidentes que correspondam a matérias diferentes. Nenhum registro ou anexo local é enviado às APIs.

Para resultados do Senado, `/dadosabertos/processo/{id}` fornece os vínculos em `identificacaoProcessoInicial`, `idProcessoCasaInicial`, `siglaCasaIniciadora` e `outrosNumeros`. A referência explícita à Câmara é validada pela pesquisa correspondente nessa Casa. Não há comparação por similaridade de ementa ou título. Se a referência não identificar um único ID da Câmara, o sistema informa a ambiguidade e não cria a equivalência.

Um resultado único e sem pendências é selecionado automaticamente; múltiplos resultados exigem escolha. Proposições encontradas somente no Senado ou somente na Câmara também podem ser selecionadas e cadastradas. A confirmação verde informa a(s) fonte(s). Se uma fonte falhar e a outra tiver resultados, há aviso e escolha explícita, sem armazenar a busca parcial no cache. Uma falha no detalhe não esconde dados válidos já retornados pela pesquisa, mas a ausência de informações é sinalizada.

O teste de referência é **PL 3361/2025 (Senado) = PL 7108/2017 (Câmara)**. Os IDs são separados: proposição da Câmara `2125467`, processo no Senado `8862684`, código de matéria do Senado `169542` e processo inicial no sistema do Senado `8862683`. Este último NÃO é um ID da API da Câmara.

Projeto, ementa e apresentação usam a Câmara quando a equivalência é confirmada; em resultados exclusivos do Senado, usam os dados do Senado. A autoria segue essa mesma origem: `/proposicoes/{id}/autores` na Câmara e `autoriaIniciativa` no detalhe do processo do Senado, com alternativa na autoria do documento. A busca também tenta obter o despacho formal e a comissão atual. Na Câmara, consulta `/proposicoes/{id}/tramitacoes`, seleciona o despacho formal mais recente (incluindo o de apensação) e o órgão da última tramitação, com `statusProposicao.siglaOrgao` como alternativa para o órgão. No Senado, consulta `autuacoes[].siglaColegiadoAtual` em `/processo/{id}` e os despachos explícitos do processo ou de `/materia/movimentacoes/{codigoMateria}.json`. Se houver dados das duas Casas, despacho e comissão seguem a Casa com situação datada mais recente; se não for possível defini-la, seguem a Casa da identificação principal. Esses dois campos são sugestões, podem ser corrigidos ou deixados em branco. Falha ou ausência desses dados não bloqueia a seleção; o formulário avisa e permite preenchimento manual. Os demais campos permanecem manuais. A situação vem de `statusProposicao.descricaoSituacao` / `dataHora` na Câmara e `situacaoAtual` / `dataSituacaoAtual` no Senado. Para uma matéria confirmada nas duas Casas (inclusive com a mesma numeração), a situação com data mais recente é destacada, com fonte, identificação e data; as situações de ambas as fontes também ficam disponíveis. A data de atualização geral do processo NÃO substitui a data da situação.

Datas ausentes, empatadas ou sem precisão para comparação (dia inteiro no Senado versus horário nesse mesmo dia na Câmara) exibem as duas situações sem afirmar qual é a mais recente. Código igual sem relação oficial não une matérias: são opções separadas, cada uma com sua situação e fonte. Os detalhes exibem também as identificações equivalentes e os IDs de cada sistema. A pesquisa textual dos registros reconhece ambas as numerações. Os campos da proposição continuam sendo uma fotografia da pesquisa; para atualizar o despacho, a comissão ou a situação salva, edite, pesquise e salve novamente (consultas completas podem ser reutilizadas por até 24 horas). A verificação periódica de novas tramitações funciona separadamente dessa fotografia.

### Avisos de novas tramitações

Com o servidor em funcionamento, uma primeira verificação começa aproximadamente 10 segundos após a inicialização e se repete a cada hora. Ela consulta o histórico de tramitações da Câmara (`/proposicoes/{id}/tramitacoes`) e os informes legislativos do Senado (`/processo/{id}`), uma vez por identificador oficial vinculado aos registros. A primeira leitura de cada fonte cria uma linha de base: acontecimentos anteriores não geram aviso. Novos acontecimentos posteriores aparecem com um ponto vermelho ao lado do projeto na tabela e, nos detalhes, com data, Casa, órgão e descrição. A lista aberta no navegador recebe atualizações em segundo plano aproximadamente a cada minuto.

Abrir o registro não descarta o aviso. Use **Marcar atualizações como vistas** para removê-lo. A confirmação é feita por acompanhamento, compartilhada entre todos os usuários porque o sistema ainda não tem login. Se uma nova tramitação for detectada depois, o aviso volta. Falhas temporárias nas APIs não apagam avisos existentes nem atualizam a linha de base. A base SQLite guarda os históricos já observados, os novos eventos e o estado de leitura; preserve-a no backup normal. Não há alteração automática nos campos manuais ou na fotografia do projeto.

O SQLite tem uma tabela `legislative_matters` com ID interno, ID da Câmara único e opcional, e snapshots separados de cada provedor; `legislative_identifiers` armazena identificações separadas por origem e seus vínculos oficiais; `proposition_search_cache` guarda buscas completas por até 24 horas. Os vínculos permanecem no banco mesmo depois do vencimento do cache. Os registros em `records` apontam para uma matéria por `matter_id`, mantêm o antigo `camara_json` para compatibilidade e salvam a fotografia completa da consulta em `proposition_json`. Uma pesquisa posterior não altera silenciosamente a situação salva em outro registro.

Uma matéria pode receber registros de áreas ou responsáveis diferentes. Um segundo registro para a mesma matéria, área e responsável é bloqueado, inclusive quando pesquisado pela outra numeração. Registros antigos com ID oficial são associados automaticamente à identidade da matéria; registros sem ID não são unificados por texto. Nenhum registro ou anexo antigo é removido. Duplicidades históricas são preservadas e podem continuar sendo editadas.

Se um registro inicialmente exclusivo do Senado receber posteriormente uma equivalência oficial com a Câmara, as identidades são consolidadas em transação. Os registros e anexos existentes são preservados, inclusive eventuais duplicidades históricas. A migração retira a obrigatoriedade do ID da Câmara mantendo os IDs internos e verificando as chaves estrangeiras. Recomenda-se backup do SQLite e dos uploads antes de atualizar o servidor.

Sem uma seleção válida, o novo registro não pode ser salvo. A seleção fica válida por duas horas; se o servidor reiniciar antes de salvar, faça a busca novamente. O servidor precisa de acesso HTTPS a `dadosabertos.camara.leg.br` e `legis.senado.leg.br`.

Os registros anteriores à integração permanecem disponíveis e editáveis sem consulta; para trocar o projeto, é necessário pesquisar. A inicialização acrescenta as novas tabelas e colunas à base existente. Após atualizar o código no servidor, reinicie o serviço NSSM e recarregue o navegador.

### Organização da integração

- `lib/camara.js`: cliente da Câmara e leitura de detalhes.
- `lib/senado.js`: cliente do Senado e extração exclusiva de relações oficiais.
- `lib/propositions.js`: coordenação da pesquisa, escolha, cache e comprovação da seleção.
- `lib/tramitations.js`: coleta periódica e identificação de tramitações novas nas duas Casas.
- `lib/database.js`: persistência das matérias, identificações, registros e cache.
- `server.js`: expõe `/api/propositions` e `/api/propositions/{selectionId}`. A seleção usa `camara-{id}` ou `senado-{id}`, nunca IDs misturados; IDs numéricos e rotas antigas continuam aliases da Câmara.

## Verificação

```powershell
npm run check
npm test
```
