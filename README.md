# VPAN

Sistema centralizado de controle de jornada por QR Code, com painel administrativo e API. O projeto contém a fundação das Fases 1–3 e já registra marcações confirmadas, mas ainda não está pronto para uso trabalhista oficial nem foi validado como sistema oficial.

## Arquitetura inicial

- `apps/web`: React, TypeScript, Vite e React Router para o painel administrativo.
- `apps/api`: Fastify, TypeScript, Prisma e SQLite. O arquivo do banco fica exclusivamente no backend.
- A API é a fonte oficial de autorização e de horário. A interface não concede privilégios.
- `Employee` é separado de `User`: cadastrar um funcionário não cria acesso ao painel.
- Usuários autenticáveis usam os papéis `ADMIN` e `MANAGER`; o administrador tem acesso global, enquanto gestores só acessam funcionários vinculados e podem enviar solicitações para aprovação.
- Decisões de produto já confirmadas: credenciais individuais por terminal; inferir o próximo evento pela jornada e pedir seleção apenas quando houver ambiguidade; exigir confirmação explícita antes de toda marcação; sem confirmar ponto offline. As regras de jornada permanecem configuráveis por funcionário e dependem de validação jurídica antes de produção.

## Desenvolvimento local

Requisitos: Node.js 20.19+ ou 22.12+ e npm.

1. Copie `apps/api/.env.example` para `apps/api/.env`. Gere os segredos (por exemplo, `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`), configure `JWT_SECRET` com um segredo aleatório de pelo menos 32 caracteres e `QR_ENCRYPTION_KEY` com 64 caracteres hexadecimais aleatórios. Não reutilize esses segredos.
2. Instale dependências: `npm install`.
3. Gere o cliente e aplique a migration: `npm run db:generate --workspace @ponto-pan/api` e `npm run db:migrate --workspace @ponto-pan/api`.
4. Crie o primeiro administrador usando `ADMIN_EMAIL`, `ADMIN_NAME` e `ADMIN_PASSWORD` no ambiente e execute `npm run admin:create --workspace @ponto-pan/api`.
5. Execute `npm run dev`.

Verificações locais: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` e `npm run build`. Formate o schema Prisma com `npm run db:format --workspace @ponto-pan/api`.

O servidor da API escuta em `127.0.0.1` por padrão. Para produção, configure HTTPS em um proxy reverso, restrinja a rede, use um segredo JWT exclusivo e armazene o banco em volume persistente. Nunca publique o diretório `apps/api/data`.

## Estado e limitações deliberadas

Esta entrega contém login administrativo, criação/listagem paginada de funcionários, validação de entrada, auditoria e emissão/visualização/revogação de credenciais QR. Funcionários não têm login. Os tokens QR são aleatórios, armazenados como hash para validação e cifrados com AES-256-GCM para permitir reexibição autorizada; mantenha `QR_ENCRYPTION_KEY` em segredo e faça backup protegido.

O terminal de ponto em `/terminal` lê códigos pela câmera, autentica cada dispositivo com uma credencial individual provisionada no painel e mostra o nome do funcionário e a marcação sugerida. A leitura e a consulta prévia não criam eventos; toda marcação exige a ação **Confirmar registro**. O evento só é gravado após essa confirmação, usando o horário do servidor. Releituras do mesmo funcionário no mesmo terminal dentro de cinco segundos e repetições com a mesma chave idempotente não criam novos eventos. A sequência é reiniciada a cada dia no horário de São Paulo e admite entrada, um intervalo e saída; depois do retorno do intervalo, só é oferecida a saída final. Antes do intervalo, quando a próxima marcação puder ser intervalo ou saída, o funcionário escolhe o tipo e depois confirma. O terminal valida sequência, mas ainda não bloqueia marcações incompatíveis com a escala nem cobre feriados, turnos noturnos ou regras trabalhistas completas. A credencial do terminal fica no armazenamento local do navegador do dispositivo: use um perfil de navegador restrito, rede protegida e HTTPS fora do localhost.

O dashboard consulta cadastros ativos, marcações do dia em horário de São Paulo, as últimas oito marcações, saldo mensal por funcionário e pedidos pendentes. “Sem saída final hoje” é uma estimativa baseada nos pontos do dia e não comprova presença física. A visão individual mostra o espelho diário do mês atual e até 50 marcações recentes; dias incompletos, horas faltantes, extras e solicitações são destacados para conferência.

Cada novo funcionário recebe uma jornada padrão de segunda a sexta, 08:00–12:00 e 13:00–17:00, sem expediente no sábado e domingo. Administradores podem publicar versões de jornada por funcionário com data inicial; os dias anteriores mantêm a regra que vigorava na época. O cálculo mensal considera faltas e horas extras somente após o fim previsto da jornada; uma sequência sem saída final fica pendente de conferência e não é contabilizada como saldo. A tolerância acordada é de até cinco minutos por marcação e dez minutos somados no dia; excedido qualquer limite, contabiliza-se a variação completa do dia. Essa regra é configuração de produto, não atestado de conformidade trabalhista.

Administradores criam gestores e limitam o acesso deles a funcionários específicos. No espelho individual, gestores podem abrir o ícone de ajuste ao lado de um dia ou marcação para solicitar correção, inclusão de ponto esquecido ou abono com motivo obrigatório. A solicitação fica pendente e não altera as marcações nem os saldos até a aprovação. O administrador precisa registrar o motivo da aprovação ou rejeição; só então a solicitação é concluída. Administradores também podem ajustar diretamente qualquer horário ou tipo de marcação, inclusive para uma data futura, ou anulá-la pelo ícone de edição, sempre com justificativa e auditoria. A anulação é lógica: a marcação permanece no histórico com seu motivo, mas deixa de participar do espelho, cálculos e sequência do terminal. Correções administrativas diretas não são bloqueadas por inconsistências de sequência, para permitir a regularização manual; o administrador responde por documentar o motivo. Abonos aprovados reduzem o saldo faltante, mas permanecem sinalizados no espelho.

Ainda não foram implementados turnos noturnos que atravessam dias, feriados, férias/licenças, escalas rotativas, cálculo completo de compensações/horas extras, anexos de comprovantes, espelhos exportáveis, fechamento, backup automatizado/restauração ou conformidade legal.

Para remover horários batidos por engano, selecione a marcação exata no histórico individual. O gestor usa **Descartar marcação incorreta** e envia a justificativa; o administrador aprova ou rejeita em **Solicitações**. O administrador pode usar **Descartar marcação** diretamente na edição, mesmo se houver pedido pendente; nesse caso, esse pedido não pode aplicar novamente o descarte e deve ser rejeitado na análise. A justificativa deve ter entre 10 e 500 caracteres; clicar em descartar sem um motivo válido exibe uma orientação no próprio modal, sem alterar a marcação. Descartes preservam o registro e sua auditoria, retirando apenas a marcação selecionada dos cálculos e da sequência do terminal, sem excluir o dia inteiro.

O objetivo informado é avaliar futuramente o uso oficial. A aplicação ainda não foi enquadrada ou validada quanto à Portaria MTP nº 671/2021 e suas alterações; não deve substituir o sistema oficial até haver avaliação técnica e jurídica, implementação dos requisitos aplicáveis e validação de conformidade. Não há dados fictícios no dashboard.

## Banco de dados

SQLite atende inicialmente a uma instalação pequena e centralizada com baixa concorrência. A migração usa chaves estrangeiras e índices Prisma; o arquivo deverá residir em armazenamento persistente protegido. Antes de produção, ainda são necessários configuração e teste de WAL/espera de bloqueio, backup externo automatizado, restauração comprovada, monitoramento e procedimento de atualização.

Considere PostgreSQL quando houver múltiplos nós de aplicação, concorrência de escrita persistente, indisponibilidade causada por bloqueios, necessidade de alta disponibilidade ou operação distribuída.
