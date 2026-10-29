# ObraMate — revisão de UX/UI

**Data:** 28 de outubro de 2026
**Escopo:** portal ObraBuilder e módulos centrais do ObraMate.

## Como a revisão foi feita

- No portal de produção autenticado, naveguei e conferi Home, Jobs, Calendar, Docs, Invoices, Requests, Companies, Team e Settings. Home e Jobs foram inspecionados visualmente; as outras rotas foram conferidas pela estrutura acessível e navegação. Também conferi Pickup locations e Price lists como subáreas de Settings.
- No ObraMate CRM, fiz leitura de código dos pontos de entrada, navegação compartilhada e fluxos de Clientes, Jobs, Quotes, Calendar, Invoices, Finance, Campo, Folha/Equipe e Configurações. O workspace contém 81 páginas HTML; a revisão foi agrupada por módulo e não representa inspeção visual individual das 81 páginas.
- O navegador estava autenticado no ObraBuilder, mas não em um workspace de empresa do CRM. Por isso, as telas do CRM abaixo são uma revisão estrutural e de código, não uma auditoria visual autenticada.

## Portal ObraBuilder — etapas revisadas

| # | Etapa | Estado geral | Evidência e ajuste |
|---|---|---|---|
| 1 | Home | Boa | Resumo, checklist de início e ações rápidas organizam bem a entrada. |
| 2 | Jobs | Boa | Busca, filtros de status e filtro por empresa sustentam o caso de um Builder que trabalha com várias empresas. |
| 3 | Calendar | Boa, com regra de data a deixar explícita | A data solicitada em um pedido novo é aplicada ao calendário quando o pedido vira Job. A tela de configuração agora explica essa consequência. |
| 4 | Docs | Boa | A navegação por empresa está clara. O estado vazio foi ajustado para explicar que só aparecem documentos compartilhados pela empresa. |
| 5 | Invoices | Boa | Filtro por empresa funciona para o cenário multiempresa. O estado vazio agora usa “flooring companies”, evitando chamar a empresa de “installer”. |
| 6 | Requests / Send work | Melhorado | O portal aceita anexo, leitura assistida, revisão dos campos e envio. O ObraMate agora configura uma única regra por empresa: revisão antes de criar ou entrada automática. |
| 7 | Companies | Boa | A relação Builder → várias empresas está explícita; o pedido escolhe a empresa de destino. Isso atende ao exemplo Senior Floors + Naka Flooring → The Colorado Floor Company. |
| 8 | Team | Boa | Membros e permissões fazem parte da conta Builder, sem misturar acessos de empresas diferentes. |
| 9 | Settings | Boa | Pickup locations e Price lists ficam agrupadas dentro da experiência do Builder. |

### Capturas da revisão do portal

As capturas de Home, Jobs e Settings → Price lists foram feitas no portal de produção autenticado durante esta revisão. Home e Jobs mostram hierarquia clara; Price lists confirma o fluxo por empresa e também evidencia o dock atual com dez destinos, que fica denso em uma viewport de tablet. A redução do dock para cinco destinos principais está no código local e ainda não aparece no sistema de produção. As demais rotas foram conferidas por navegação e árvore acessível, sem capturas visuais completas.

## ObraMate CRM — revisão por módulo

| Módulo | Leitura atual | Ajuste feito / próximo ganho |
|---|---|---|
| Início e navegação | A navegação compartilhada cobre as tarefas frequentes, mas o produto combina páginas antigas e novas. Alguns nomes ainda misturam português e inglês. | Consolidar rótulos e estados de navegação numa passada visual com acesso de tenant. |
| Leads e Pipeline | Leads, pipeline, visitas e quotes têm atalhos entre si; há superfícies diferentes para lista e quadro. | Alinhar os estados vazios e os CTAs para manter “próxima ação” previsível entre lista, pipeline e detalhe. |
| Clientes | É a área operacional que deve concentrar Builder e Contractors. O portal de acesso é mostrado no detalhe do cadastro. | Builders conectados agora ganham um cadastro Customer associado; o detalhe reconhece acesso ObraBuilder e evita oferecer suspensão/senha local para uma conta administrada no portal. |
| Jobs | A lista liga a pedidos de parceiros, detalhes, faturamento e agenda. | A nova regra de entrada dos pedidos aparece na fila e deixa o comportamento automático ou com aprovação configurável. |
| Calendar | A agenda é uma superfície própria e recebe links de Jobs, Leads e visitas. | Explicar visualmente a diferença entre “data solicitada” e data confirmada pode evitar compromissos assumidos sem revisão. |
| Quotes | Quotes e Builder pricing são usados em vários fluxos de cliente e Job. | Revisar consistência de termos e estados de quote no próximo passe visual autenticado. |
| Invoices e Finance | Invoices estão ligadas a Customers e Jobs; Finance agrega recebíveis e alertas. | Validar hierarquia de saldo, vencimento e ações em desktop e celular com dados reais mascarados. |
| Campo / ObraCam | Agenda de campo, tickets e relatórios atendem a execução da obra. | Fazer uma revisão específica em telefone para avaliar alvos, upload de fotos e leitura sob uso em campo. |
| Equipe / Folha | Permissões e jornadas de folha ficam divididas em módulos administrativos e autoatendimento. | Reduzir diferenças de vocabulário entre equipe, horas, aprovações e pagamentos. |
| Configurações | Concentra regras, preferências e catálogos. | Tornar as regras de portal fáceis de encontrar também a partir de Jobs; a tela de pedidos já oferece contexto e controle da regra. |
| Superfícies legadas de Builder | Existem rotas antigas de Builders e portal além do ObraBuilder integrado. | Manter o foco operacional em Clientes e preservar compatibilidade das rotas legadas até confirmar o uso restante. |

## Mudanças implementadas

1. A navegação principal do ObraBuilder ficou com cinco destinos: Home, Jobs, Calendar, Invoices e More. Requests, Docs, Companies, Team, Settings e Measurements continuam disponíveis em More.
2. A empresa pode escolher se pedidos novos aguardam aprovação ou entram automaticamente como Jobs. A configuração fica em Pedidos de jobs, tem proteção por permissão e mantém o status dos pedidos existentes.
3. A regra vale para os dois caminhos de acesso (conta ObraBuilder e usuário de portal legado), inclusive pedidos enviados enquanto uma empresa ainda está sendo convidada.
4. Builders de contas conectadas passam a ficar visíveis em Clientes com jobs e quotes antigos associados ao novo cadastro. A sincronização roda na conexão e é reconciliada no próximo login da conta para links antigos.
5. Clientes identifica esse acesso como ObraBuilder e não mostra controles de senha ou suspensão do portal legado para esse tipo de conta.
6. Ajustei os estados vazios de Docs e Invoices e removi a notificação incorreta que dizia que pedidos entregues automaticamente sempre iam para “Jobs sem data”.

## Limites e próxima etapa

O portal foi revisado com acesso real de Builder; o workspace CRM do tenant não estava autenticado neste navegador. Uma passada visual completa no CRM ainda precisa de uma sessão de empresa e deve cobrir ao menos desktop e telefone para Clientes, Jobs, Calendar, Quotes e Invoices. Capturas de tela não substituem testes de teclado, leitor de tela, contraste e tamanho de toque.
