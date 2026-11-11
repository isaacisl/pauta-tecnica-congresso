# Pauta Técnica

Aplicativo web local para cadastrar e acompanhar projetos prioritários por área técnica. Os dados ficam em uma base SQLite no próprio computador.

## Acompanhamento não informado

Parecer elaborado, Sugestão de emenda e Posicionamento da área também aceitam **N/I — Não informado**, além da prioridade. Novos cadastros começam com essas classificações em N/I. Elas podem ser completadas pelos técnicos posteriormente e continuam disponíveis na edição, nos filtros, na totalização, no histórico e na exportação. Os gráficos distinguem N/I de respostas negativas e de posicionamento indiferente.

Na importação, é possível enviar apenas a coluna Projeto: as classificações ausentes ou vazias ficam em N/I. Área e responsável são escolhidos exclusivamente no sistema, na conferência, e continuam obrigatórios. Valores preenchidos mas desconhecidos nas classificações precisam ser corrigidos; eles não são transformados silenciosamente em N/I. As classificações vêm da planilha; a conferência individual permite corrigir pendências, incluindo prioridade. Não há painel para aplicar classificações em lote. Nenhum valor de acompanhamento já cadastrado é reclassificado por esta atualização.

## Filtros com checkboxes

Os filtros de área técnica, responsável, parecer elaborado, sugestão de emenda, posicionamento e prioridade permitem marcar várias opções nas abas Registros e Totalização. Clique no filtro para abrir os checkboxes; as listas de áreas e responsáveis também possuem busca. Opções do mesmo campo são alternativas (Alta **ou** Média, por exemplo); campos diferentes são combinados (prioridade **e** área). Nenhuma opção marcada equivale a todas.

Cada aba mantém sua própria seleção. É possível limpar um campo ou todos os filtros; escolhas marcadas permanecem visíveis mesmo quando a combinação não encontra resultados. A exportação respeita todas as opções marcadas em Registros. As opções disponíveis continuam relacionadas aos registros e aos demais filtros, sem incluir responsáveis de outras áreas que não tenham acompanhamentos na seleção. A busca textual e os seletores de cadastro e edição permanecem disponíveis.

## Prioridade dos registros

Cada acompanhamento tem uma prioridade: **Alta**, **Média**, **Baixa** ou **N/I (não informado)**. O novo cadastro começa em N/I e a classificação pode ser alterada na edição. A prioridade aparece na tabela, nos detalhes, no histórico de alterações e na exportação CSV. Os filtros de Registros e Totalização permitem selecionar uma prioridade e combiná-la com os demais critérios; os indicadores refletem os acompanhamentos da seleção.

Na primeira inicialização desta versão, a migração acrescenta o campo com N/I a todos os registros antigos, inclusive os da lixeira, preservando documentos, datas e revisões. Ela não cria eventos de edição. Importações e clientes antigos que omitam o campo no cadastro recebem N/I; na edição, a omissão preserva a prioridade já salva. Faça backup antes de atualizar o servidor e recarregue o navegador depois do reinício.

## Consolidação de confiabilidade — outubro/2026

- **Edição concorrente:** registros possuem `revision`. PUT e DELETE exigem a versão aberta pelo usuário (428 se ausente, 409 se desatualizada). O formulário preserva o preenchimento em caso de conflito. Reabra o registro para conferir a versão atual antes de tentar novamente. Envios de documentos também avançam a versão.
- **Lixeira:** excluir agora oculta o acompanhamento da lista, filtros, totais e monitoramento, sem apagar seus documentos. O botão Lixeira permite restaurá-lo. A restauração bloqueia uma duplicidade ativa de matéria + área + responsável. Não há purga automática.
- **Documentos:** na edição de um acompanhamento, cada anexo salvo pode ser removido com confirmação e restaurado em “Documentos removidos”. Arquivos removidos deixam de aparecer entre os ativos e não podem ser baixados, mas permanecem no armazenamento e no backup para permitir restauração. Não há exclusão física automática.
- **Histórico:** a aba Acompanhamento oferece o histórico de inclusão, edição, exclusão e restauração, com antes/depois dos campos. Não se reconstroem alterações anteriores à implantação e, sem login, não se atribui uma pessoa à operação. Documentos mantêm seu histórico próprio.
- **Pesquisa:** o leitor do Senado reconhece também `siglaColegiadoControleAtual`. Na consolidação das Casas, a navegação utiliza a origem **e o ID** da situação vencedora. Homônimos não herdam despacho/comissão de outra matéria.
- **Atualização explícita:** marque “Consultar dados atualizados nas APIs (ignorar cache)” antes de pesquisar. O sistema consulta novamente as fontes, sem atualizar outros acompanhamentos silenciosamente. Ajustes manuais de despacho/comissão exigem confirmação para substituição na mesma matéria.
- **Monitoramento:** os detalhes mostram a última consulta bem-sucedida, primeira verificação pendente, atraso e falha. Um novo vínculo solicita uma verificação próxima ao cadastro; eventos inequivocamente posteriores ao início do acompanhamento não são descartados quando a primeira consulta demora. Datas oficiais sem horário não permitem determinar a ordem dentro do mesmo dia. Registros antigos sem referência inicial continuam usando a primeira consulta como linha de base.
- **Correções de eventos:** Câmara usa a sequência oficial no contexto da proposição; Senado usa o ID do informe. Correções atualizam o texto armazenado sem gerar uma segunda notificação. A migração reconhece o hash antigo da Câmara quando o conteúdo coincide, preservando o ID interno e a leitura. Se a fonte alterar o conteúdo antes dessa primeira conversão, pode haver um aviso adicional na transição; não são apagados avisos antigos.
- **Exportação e importação:** CSV em UTF-8 com BOM para Excel, preservando Unicode e neutralizando células que poderiam virar fórmulas na exportação. A mesma senha, configurável por `EXPORT_PASSWORD`, protege exportação e rotas exclusivas de importação, com o padrão anterior mantido por compatibilidade. As demais rotas mantêm o comportamento existente.

Antes de atualizar o servidor, faça backup. Depois do `git pull`, reinicie o serviço NSSM e recarregue os navegadores: formulários de versões antigas não podem sobrescrever registros sem controle de revisão. As migrações são aditivas e preservam registros e anexos; não volte a executar uma versão antiga do servidor sobre a base migrada, pois versões antigas não reconhecem a lixeira nem a remoção de anexos.

No servidor Windows, o serviço deste projeto chama-se `PautaTecnica`, conforme informado pelo responsável. O comando usado para reiniciá-lo é `nssm restart PautaTecnica`.

### Backup e recuperação

```powershell
npm run backup
# Opcional: informar uma pasta de destino protegida
npm run backup -- D:\Backups\PautaTecnica
```

O comando usa `DATABASE_PATH` quando configurado. Cria um snapshot consistente do SQLite (incluindo transações confirmadas no WAL) e copia todos os documentos referenciados, inclusive da lixeira. O padrão é `data/backups/`, ignorado pelo Git. Só considere completo um diretório com `backup-completo.json`; falta de documento ou falha de integridade interrompe o processo. Copie os backups também para um local protegido fora do disco do servidor e estabeleça retenção conforme a política da empresa.

Para restaurar, pare o serviço, preserve a instalação atual inteira e use o `registros.sqlite` e a pasta `uploads` do mesmo backup em um diretório novo. Aponte `DATABASE_PATH` para esse arquivo e inicie o serviço atualizado. Não misture o snapshot restaurado com arquivos `-wal`/`-shm` de outra base. O teste automatizado de backup verifica reabertura, histórico, lixeira e documentos; também teste a recuperação na infraestrutura do servidor.

### Áreas e responsáveis

A lista de colaboradores foi importada de `Colaboradores_confederando.xlsx` (02/10/2026). Em 11/11/2026, a planilha `Consultores CNM - Áreas Técnicas.xlsx` redistribuiu os consultores nas áreas correspondentes, com as equivalências confirmadas pelo responsável do sistema. A lista atual tem 173 pessoas em 46 áreas, sem a opção genérica `Consultor`. Mário Nascimento atua em Desenvolvimento Rural e Turismo. Vitória Jadallah passou de Assistência Social para a nova área Políticas sobre Drogas. Previdência e Segurança Alimentar também foram acrescentadas. Os demais colaboradores permanecem em seus setores.

Na primeira inicialização da versão atualizada, os acompanhamentos dos consultores, inclusive na lixeira, são transferidos para as áreas da planilha. Os eventuais acompanhamentos de Vitória também passam para Políticas sobre Drogas. A operação é transacional e executada uma única vez, controlada por `directory_migrations`: preserva IDs, inclusão, classificações, anexos, vínculos legislativos, tramitações e histórico anterior; acrescenta o antes/depois da transferência ao histórico e avança a revisão e a data de edição. Nenhum registro é apagado ou unido, inclusive se vínculos antigos convergirem para a mesma combinação. Uma eventual área antiga de Mário fora das duas áreas confirmadas é preservada, com pendência na interface e aviso no log para escolha explícita na edição. Faça backup antes da atualização e recarregue o navegador depois do reinício. Formulários abertos anteriormente recebem conflito de revisão.

José Rafael Correa é reconhecido pelo nome anterior Rafael Correa, e Nancy de Andrade pelo anterior Nancy Ramos. Pedro Passos e Roberto Siegmann não constam na planilha nova e saem das opções de novos cadastros; eventuais vínculos salvos permanecem consultáveis e editáveis na área original, sem incluir esses nomes nas opções de outros registros. As correspondências Consórcios Públicos → Consórcios, Finanças → Finanças e Tributação, Jurídico → Jurídico Técnico, Obras → Obras, Transferências e Parcerias, Orçamento Público → Orçamento e Saneamento → Sustentabilidade são reconhecidas, assim como a forma anterior Planej. Territ. e Habitação. Sufixos `(Colaborador)` e `(Consultor)` e variações de espaços/acentos da mesma pessoa continuam reconhecidos.

O cadastro e a importação mostram somente os responsáveis da área escolhida. Trocar de área limpa uma seleção incompatível. Os filtros de Registros e Totalização exibem apenas pessoas com acompanhamentos na área selecionada. A API valida os mesmos vínculos; pendências restantes aparecem ao lado do responsável e podem ser corrigidas na segunda etapa da edição. Áreas históricas só permanecem nos filtros quando possuem acompanhamentos.

### Informações dos documentos e classificação da tabela — outubro/2026

Cada novo arquivo exige título (até 180 caracteres) e descrição (até 4.000 caracteres), inclusive em seleções múltiplas. O nome físico/original do arquivo, o conteúdo e a data de inclusão não são modificados ao editar essas informações. Documentos antigos continuam válidos sem preenchimento: são identificados pelo nome original e podem ser complementados em **Completar informações**. **Editar informações** permite revisar título e descrição em uma janela própria, sem perder o formulário do acompanhamento que estiver sendo preenchido.

A migração adiciona somente `title`, `description` e `metadata_updated_at` em `record_attachments`. Não apaga documentos, não inventa datas ausentes e não reescreve registros antigos. Inclusão e edição de informações de documentos geram histórico com antes/depois, avançam a revisão e a data de edição do acompanhamento; a edição exige a revisão atual e não aceita documentos removidos, na lixeira ou pertencentes a outro acompanhamento. Backup e restauração preservam os novos campos junto dos originais.

O envio pelo navegador utiliza `multipart/form-data` com `file`, `title` e `description`, até 20 MB por arquivo; não é necessário instalar novas dependências. Clientes binários devem enviar também `X-Document-Title` e `X-Document-Description`, codificados com `encodeURIComponent`, além de `X-File-Name`. `PUT /api/records/:id/attachments/:attachmentId` recebe JSON `{ revision, title, description }`. O identificador de envio continua evitando anexos duplicados em novas tentativas. Metadados diferentes para um envio já concluído geram conflito, em vez de descartar silenciosamente a edição.

Na tabela, **Classificar** oferece Atualizações primeiro e inclusão/última edição em ordem crescente ou decrescente. A classificação inicial coloca acompanhamentos com novas tramitações pendentes no topo, pela detecção mais recente; os demais seguem inclusão mais recente. A ordem é aplicada sobre todos os resultados antes da paginação de 5/10/25 itens, com desempate determinístico por inclusão e ID. Mudar a classificação volta à primeira página e mantém os filtros. Registros sem edição ficam no final em ambas as ordens por edição; consultas do monitoramento não são consideradas edições. O servidor e a página usam a versão 4 da API: depois de atualizar, reinicie o serviço e recarregue os navegadores.

### Visualização de documentos

Nos detalhes e na edição do acompanhamento, **Visualizar** abre o documento em uma janela do sistema. PDF, PNG e JPEG são exibidos diretamente. O leitor PDF possui navegação por páginas, zoom e ajuste à tela; quando disponível, há uma seção com o texto da página para leitura e cópia. O sistema distribui [PDF.js](https://mozilla.github.io/pdf.js/) 6.3.289 localmente em `public/vendor/pdfjs/`, carregado apenas ao abrir uma prévia PDF, sem CDN nem envio dos documentos a terceiros. Word (`.doc` e `.docx`), ODT e RTF são convertidos para uma prévia PDF no primeiro acesso; o arquivo original e sua data de inclusão permanecem preservados. Excel e PowerPoint continuam disponíveis por **Baixar**. A prévia pode apresentar diferenças de formatação, principalmente se faltarem as fontes usadas no documento.

Para as prévias de Word, instale uma versão atualizada do [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) **no servidor que executa o NSSM**, incluindo as fontes utilizadas nos documentos. Não é necessário instalar Word/Microsoft Office nem LibreOffice nos computadores dos usuários. No Windows, o sistema procura `C:\Program Files\LibreOffice\program\soffice.com` (e a pasta equivalente para instalações de 32 bits). Em Linux, procura `libreoffice`/`soffice` no PATH. Para uma instalação em outro local, configure `LIBREOFFICE_PATH` com o caminho do executável na configuração de ambiente do serviço NSSM, preservando as demais variáveis já configuradas. Reinicie o serviço após instalar/configurar. A conta do serviço precisa conseguir executar o LibreOffice e gravar na pasta de dados.

A conversão usa os [parâmetros oficiais de linha de comando](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html), sem janela interativa, com um perfil temporário próprio e macros bloqueadas. Há uma conversão por vez, até seis documentos na fila e limite de 90 segundos por conversão. Consultas simultâneas ao mesmo documento compartilham o trabalho. Arquivos protegidos por senha, danificados ou falhas do conversor mostram uma mensagem e mantêm o download original disponível.

As prévias ficam em `previews`, ao lado de `uploads` e do banco configurado por `DATABASE_PATH` (padrão: `data/previews/`). São arquivos derivados e ignorados pelo Git; `npm run backup` continua salvando o banco e os originais, sem incluir esse cache, que pode ser recriado. Uma prévia existente não dispensa a verificação de que o registro e seu documento continuam ativos. Documentos removidos ou registros na lixeira não podem ser visualizados. Nenhuma tabela ou migração nova é necessária para esta funcionalidade; ela também atende aos anexos já cadastrados.

### Limites mantidos deliberadamente

Não foram adicionados login, permissões por pessoa ou exclusão automática de registros de teste. O serviço deve permanecer restrito a uma rede confiável/VPN ou a um controle de acesso externo. Proteja a pasta de backups: ela contém toda a base. A paginação continua no navegador; otimização para grandes bases e revisão dos registros sem vínculo oficial são etapas separadas. Não se unem registros antigos apenas por coincidência de nome.

## Como executar

Requisito: Node.js 22.13 ou mais recente. As funções de normalização de nomes nos filtros usam a API `DatabaseSync.function`, disponível a partir dessa versão. Esta atualização foi testada com Node.js 24.13.

```powershell
npm start
```

Depois, abra [http://127.0.0.1:3000](http://127.0.0.1:3000) no navegador. Para encerrar, pressione `Ctrl+C` no terminal.

## Recursos

### Importação de acompanhamentos

O botão **Importar planilha** solicita a mesma senha da exportação antes de abrir as três etapas: planilha, conferência e importação. A validação ocorre também no servidor para ler a planilha e gravar cada acompanhamento. A senha fica somente na memória do lote aberto e é descartada ao fechá-lo. Aceita `.xlsx` sem macros/senha e `.csv` UTF-8, até 8 MB, 500 linhas de dados por aba e 60 colunas.

O modelo CSV baixado contém **Projeto, Prioridade, Parecer elaborado, Sugestão de emenda e Posicionamento**, com quatro exemplos fictícios de PL no ano futuro 2099. Substitua os exemplos pelos projetos reais antes de importar. Área técnica e responsável não são colunas de importação: ambos são escolhidos no sistema. A tabela do tutorial usa os mesmos exemplos, que não são cadastrados automaticamente.

Escolha a aba e confira a associação das cinco colunas. Na conferência, selecione a área técnica e um responsável padrão para o lote, ou ajuste a atribuição em cada projeto. As opções vêm do diretório do sistema, e o responsável precisa pertencer à área escolhida. Ambos permanecem obrigatórios. Colunas antigas de área e responsável são ignoradas, mesmo quando preenchidas. Prioridade, parecer, emenda e posicionamento ausentes ou vazios ficam em N/I para preenchimento posterior. Valores desconhecidos nas classificações ficam pendentes para correção; nenhuma classificação é convertida automaticamente em “Não” ou “Indiferente”. Autor, ementa e tramitação são buscados nas fontes oficiais. Outros campos e hyperlinks da planilha não são importados.

A conferência mostra quantas pautas distintas não foram localizadas na Câmara nem no Senado, seus nomes e as linhas correspondentes. Formatos inválidos, consultas com falha e resultados que exigem escolha não são tratados como inexistentes. Corrigir e consultar novamente atualiza o resumo. As linhas pendentes não são importadas, e as válidas selecionadas podem ser confirmadas normalmente.

Clientes da API enviam a senha codificada com `encodeURIComponent` em `X-Import-Password` nos POSTs de `/api/import/authorize`, `/api/import/preview` e `/api/import/records`. A senha não deve ser enviada em URLs. A capacidade de importação anunciada em `/api/health` é a versão 2; reinicie o servidor e recarregue os navegadores após atualizar.

Selecione o arquivo em **Selecionar planilha**. O nome e o tamanho aparecem junto ao botão; use **Trocar planilha** para escolher outro arquivo. Na conferência, escolha área e responsável no sistema, por padrão para o lote ou nos detalhes de cada projeto. A **prévia dos acompanhamentos** mostra uma tabela com área, responsável, projeto, posicionamento, prioridade, parecer, emenda e situação da conferência. Ela usa o visual da lista principal, com paginação, filtro de pendências e seleção por projeto; em telas estreitas, role a tabela para os lados. Use **Conferir** para corrigir uma linha, consultar os dados oficiais, selecionar a matéria correta quando houver ambiguidade ou adicionar documentos. As correções aparecem na tabela antes de salvar. Prioridade, parecer, emenda e posicionamento são lidos da planilha, com N/I nos valores vazios, sem painel de aplicação de classificações em lote. Até três projetos são consultados em paralelo, preservando a ordem das linhas e compartilhando a consulta de identificações repetidas. A conferência não cria acompanhamentos antes da confirmação final. Datas de inclusão e edição só existem após o cadastro; datas legislativas, autoria, ementa, despacho e comissão vêm da busca oficial já existente, não do texto antigo da planilha.

A consulta inicial aproveita resultados oficiais completos e sem avisos armazenados por até 24 horas. Consultas vencidas voltam às fontes. **Consultar novamente**, nos detalhes do projeto, e **Consultar pendentes novamente**, na lista, ignoram o cache para tentar obter dados atualizados. Ambiguidades e avisos gerais de pesquisa continuam exigindo escolha. Avisos específicos de autoria/tramitação mantêm a política anterior de seleção, mas impedem cache. Fechar ou voltar interrompe o início de novos projetos no lote; cancelar a busca remove chamadas ainda enfileiradas e interrompe as ativas, e respostas de uma prévia anterior não alteram a seguinte.

Buscas, importações e monitoramento usam filas compartilhadas por fonte no processo Node. O padrão é de até **8 inícios de requisição por segundo e 3 chamadas em andamento por fonte**, com espaçamento regular. O limite de concorrência inclui o recebimento do corpo da resposta. Os valores são controles internos conservadores, não uma declaração do limite oficial da Câmara. Limites podem ser ajustados pela opção `officialRequestLimits` da inicialização do servidor, com `camara`/`senado`, `requestsPerSecond` e `maxConcurrent`. Instalações com vários processos Node precisam de coordenação externa para compartilhar o orçamento entre eles. Esta mudança não acrescenta repetição automática de falhas; elas permanecem pendentes para nova consulta explícita.

Cada projeto pode receber documentos com título e descrição obrigatórios. Os anexos são opcionais, até 20 MB por arquivo, 20 por projeto e 100 MB no lote. A confirmação informa os itens que ficarão de fora. Os registros são salvos individualmente: se houver falha em um documento, o acompanhamento criado é mantido e a tentativa seguinte envia somente o que falta. Itens com pendências não bloqueiam os demais. Acompanhamentos existentes não são sobrescritos, e duplicidades de matéria + área + responsável são recusadas no servidor.

O controle de reenvio usa a tabela aditiva `import_receipts`, vinculada aos registros, com identificador único e assinatura do conteúdo enviado. O recibo é gravado na mesma transação do cadastro e persiste após reinício. Documentos usam os identificadores idempotentes já existentes. Uma resposta perdida pode ser consultada novamente pela repetição exata do envio, sem novo cadastro; alterações de conteúdo para o mesmo identificador são recusadas. A prévia e os arquivos ainda não enviados ficam apenas na memória da aba: fechar ou recarregar descarta esse rascunho com aviso, mas preserva os registros já criados. Uma resposta incerta bloqueia temporariamente a edição da linha até a confirmação por reenvio.

**Atualização no servidor:** faça backup, atualize o código e execute `npm.cmd ci` na pasta do projeto antes de iniciar/reiniciar o NSSM. Esta funcionalidade acrescenta o leitor XML `fast-xml-parser`, com versão fixada no lockfile. O restante da leitura ZIP é limitado em memória, sem extração para disco, execução de fórmulas ou acesso a links externos. A migração apenas cria a tabela de recibos, sem modificar os registros e anexos existentes. O backup SQLite já inclui a nova tabela automaticamente.

### Totalização visual

A totalização apresenta seis indicadores (projetos distintos, acompanhamentos, com parecer, com sugestão de emenda, favoráveis e desfavoráveis), gráficos de rosca por status e barras empilhadas por área. As cores das barras correspondem aos posicionamentos reais de cada área; o comprimento total é proporcional à área com mais acompanhamentos. A coluna percentual usa o total de acompanhamentos da seleção, assim como os gráficos e indicadores de status. Parecer “Em andamento” não conta como parecer concluído. Todos os filtros atualizam o conjunto inteiro e restringem a lista de responsáveis à área selecionada.

Esta alteração não modifica o schema nem os registros do SQLite. A API `/api/totals` acrescenta `byAreaPosition` com área, posicionamento e quantidade. Reinicie o processo Node após atualizar o servidor; enquanto ele ainda estiver na versão anterior, a interface pode calcular essa distribuição com os registros filtrados, sem alterar dados.

### Funcionalidades

- cadastro, edição e exclusão de registros;
- cadastro e edição em três etapas: Projeto (busca e dados legislativos), Acompanhamento (área, responsável e classificações) e Documentos (arquivos, títulos e descrições);
- documentos opcionais, com a opção Salvar sem documentos somente na terceira etapa quando não houver arquivos ativos ou pendentes; cadastro e edição só podem ser finalizados nessa etapa, e arquivos já existentes são preservados ao salvar alterações;
- consulta do registro nas abas Projeto, Acompanhamento e Documentos, com quantidade de arquivos ativos na terceira aba e edição aberta diretamente na etapa consultada;
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

Os documentos ficam na terceira etapa do cadastro e da edição, separados dos campos de acompanhamento. É possível selecionar vários arquivos (até 20 MB cada), com título e descrição obrigatórios para cada arquivo escolhido. Os anexos são opcionais, mas a finalização ocorre sempre na terceira etapa, com ou sem documentos. A segunda etapa permite somente voltar ou continuar; um envio pelo formulário nessa etapa também apenas avança, sem gravar. Voltar entre as etapas preserva campos, arquivos e metadados; erros abrem a etapa correspondente para correção. Ao salvar, cada arquivo é acrescentado ao histórico com sua própria data, sem substituir documentos anteriores, mesmo com nomes iguais.

Nos detalhes, a aba Documentos mostra a quantidade de arquivos ativos, informações, visualização, download e consulta dos documentos removidos; o botão Editar documentos abre diretamente a terceira etapa. O histórico de alterações do registro permanece em Acompanhamento. As três abas aceitam navegação por setas, Home e End. Arquivos pendentes podem ser retirados da seleção; documentos já salvos permanecem no histórico. Ao excluir o registro, seus documentos permanecem preservados na lixeira e voltam a ficar disponíveis após a restauração. Esta reorganização não altera o servidor nem os dados existentes; recarregue a página para obter o novo formulário.

Os metadados ficam em `record_attachments`. Na primeira inicialização desta versão, os anexos antigos são migrados automaticamente, mantendo os arquivos em seus locais originais. Como a versão anterior não registrava a data de envio separadamente, esses arquivos mostram “Data de inclusão não registrada”. Os novos documentos recebem a data do servidor. Envios interrompidos podem ser repetidos no mesmo formulário sem duplicar um arquivo já recebido.

## Consulta legislativa e equivalências

No novo cadastro, selecione um dos 12 tipos disponíveis e digite número e ano. A consulta só ocorre ao clicar em **Pesquisar** com os três parâmetros válidos. A pesquisa verifica o cache local e, quando necessário, consulta a Câmara (`/api/v2/proposicoes`) e o Senado (`/dadosabertos/processo?sigla=...&numero=...&ano=...`). As duas Casas são verificadas nas pesquisas ainda não armazenadas para identificar também números coincidentes que correspondam a matérias diferentes. Nenhum registro ou anexo local é enviado às APIs.

Para resultados do Senado, `/dadosabertos/processo/{id}` fornece os vínculos em `identificacaoProcessoInicial`, `idProcessoCasaInicial`, `siglaCasaIniciadora` e `outrosNumeros`. A referência explícita à Câmara é validada pela pesquisa correspondente nessa Casa. Não há comparação por similaridade de ementa ou título. Se a referência não identificar um único ID da Câmara, o sistema informa a ambiguidade e não cria a equivalência.

Um resultado único e sem pendências é selecionado automaticamente; múltiplos resultados exigem escolha. Proposições encontradas somente no Senado ou somente na Câmara também podem ser selecionadas e cadastradas. A confirmação verde informa a(s) fonte(s). Se uma fonte falhar e a outra tiver resultados, há aviso e escolha explícita, sem armazenar a busca parcial no cache. Uma falha no detalhe não esconde dados válidos já retornados pela pesquisa, mas a ausência de informações é sinalizada.

O teste de referência é **PL 3361/2025 (Senado) = PL 7108/2017 (Câmara)**. Os IDs são separados: proposição da Câmara `2125467`, processo no Senado `8862684`, código de matéria do Senado `169542` e processo inicial no sistema do Senado `8862683`. Este último NÃO é um ID da API da Câmara.

Projeto, ementa e apresentação usam a Câmara quando a equivalência é confirmada; em resultados exclusivos do Senado, usam os dados do Senado. A autoria segue essa mesma origem: `/proposicoes/{id}/autores` na Câmara e `autoriaIniciativa` no detalhe do processo do Senado, com alternativa na autoria do documento. A busca também tenta obter o despacho formal e a comissão atual. Na Câmara, consulta `/proposicoes/{id}/tramitacoes`, seleciona o despacho formal mais recente (incluindo o de apensação) e o órgão da última tramitação, com `statusProposicao.siglaOrgao` como alternativa para o órgão. No Senado, consulta `autuacoes[].siglaColegiadoAtual` em `/processo/{id}` e os despachos explícitos do processo ou de `/materia/movimentacoes/{codigoMateria}.json`. Se houver dados das duas Casas, despacho e comissão seguem a Casa com situação datada mais recente; se não for possível defini-la, seguem a Casa da identificação principal. Esses dois campos são sugestões, podem ser corrigidos ou deixados em branco. Falha ou ausência desses dados não bloqueia a seleção; o formulário avisa e permite preenchimento manual. Os demais campos permanecem manuais. A situação vem de `statusProposicao.descricaoSituacao` / `dataHora` na Câmara e `situacaoAtual` / `dataSituacaoAtual` no Senado. Para uma matéria confirmada nas duas Casas (inclusive com a mesma numeração), a situação com data mais recente é destacada, com fonte, identificação e data; as situações de ambas as fontes também ficam disponíveis. A data de atualização geral do processo NÃO substitui a data da situação.

Datas ausentes, empatadas ou sem precisão para comparação (dia inteiro no Senado versus horário nesse mesmo dia na Câmara) exibem as duas situações sem afirmar qual é a mais recente. Código igual sem relação oficial não une matérias: são opções separadas, cada uma com sua situação e fonte. Os detalhes exibem também as identificações equivalentes e os IDs de cada sistema. A pesquisa textual dos registros reconhece ambas as numerações. Os campos da proposição continuam sendo uma fotografia da pesquisa; para atualizar o despacho, a comissão ou a situação salva, edite, pesquise e salve novamente (consultas completas podem ser reutilizadas por até 24 horas). A verificação periódica de novas tramitações funciona separadamente dessa fotografia.

### Avisos de novas tramitações

Com o servidor em funcionamento, uma primeira verificação começa aproximadamente 10 segundos após a inicialização e se repete a cada hora. Ela consulta o histórico de tramitações da Câmara (`/proposicoes/{id}/tramitacoes`) e os informes legislativos do Senado (`/processo/{id}`), uma vez por identificador oficial vinculado aos registros. A primeira leitura de cada fonte cria uma linha de base: acontecimentos anteriores não geram aviso. Novos acontecimentos posteriores aparecem em linhas destacadas com selo textual e quantidade de novas tramitações. Clicar no selo abre os detalhes com data, Casa, órgão e descrição. O aviso acima dos filtros informa quantos acompanhamentos têm pendências na seleção atual, sem multiplicar a contagem pela quantidade de eventos ou confundir acompanhamentos da mesma matéria.

**Ver atualizados** ativa o filtro **Atualizações → Pendentes**, preservando os demais critérios; **Exibir todos** remove somente esse filtro. A seleção combina com área, responsável, busca e classificações, aparece entre os filtros ativos e é respeitada pela exportação CSV. A API aceita `atualizacoes=Pendentes` na lista, opções, totais e exportação. A lista retorna também `pendingUpdates`, contado dentro dos demais critérios. A aba Totalização continua com seus filtros próprios. A página atualiza lista, contador e opções aproximadamente a cada minuto enquanto está visível e sem diálogos abertos.

Abrir o registro não descarta o aviso. Use **Marcar atualizações como vistas** para removê-lo; a lista, opções e contador são recarregados, e o acompanhamento sai do filtro caso não tenha outras novidades. A confirmação é feita por acompanhamento, compartilhada entre todos os usuários porque o sistema ainda não tem login. Se uma nova tramitação for detectada depois, o aviso volta; uma novidade recebida durante a leitura também permanece pendente. Falhas temporárias nas APIs não apagam avisos existentes nem atualizam a linha de base. A base SQLite guarda os históricos já observados, os novos eventos e o estado de leitura; preserve-a no backup normal. Não há alteração automática nos campos manuais, na prioridade Alta/Média/Baixa/N/I ou na fotografia do projeto.

Esta melhoria não exige migração de dados. A saúde da API informa `updateNotices: 1`; o navegador exige esse suporte para evitar filtros novos com um servidor anterior. Atualize o código, reinicie o serviço e recarregue a página.

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
