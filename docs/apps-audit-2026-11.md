# ObraMate, ObraBuilder, ObraCrew e ObraCam: auditoria de UX, padronização, desempenho e animação

**Data:** 5 de novembro de 2026
**Método:** leitura de código. Os apps não foram abertos em navegador nem em celular. Os itens marcados ✔ foram conferidos à mão, linha a linha.
**Skills usadas:** `impeccable` (audit), `mobile-native`, `ui-ux-pro-max`, `find-animation-opportunities`, `animation-performance`.

| App | Onde está | Peso da 1ª carga (JS+CSS, sem compressão) |
|---|---|---|
| ObraMate CRM | `crm/public/*.html`, shell em `crm-shared-nav.js` + `om-mobile-nav.js` | dashboard ~1,3 MB · jobs ~1,1 MB · quote-builder ~1,1 MB |
| ObraBuilder | `partner-portal.html/js`, `partner-portal-v2.css` | ~1,05 MB |
| ObraCrew | `crm/public/campo/` (`/obracrew` → `campo/hoje.html`) | ~444 KB |
| ObraCam | `/obracam` = `job-media-board.html` + `obracam-app.*` | ~1,5 MB, sem contar as fotos |

Nota do impeccable para o CRM: **7/20**. Acessibilidade 2, Desempenho 1, Theming 1, Responsivo 2, Integridade 1.

---

## 0. Bugs para corrigir antes de qualquer etapa

1. ✔ **ObraCrew: bater o ponto não funciona sem sinal.** `canQueueMutation` (`crm/public/om-offline.js:95-105`) não inclui `/api/campo/dia/start` nem as outras ações do dia. "Começar o dia" dá erro no canteiro sem 4G.
2. ✔ **ObraCrew: a foto aparece como "enviada" quando só foi para a fila.** Sem rede, `postPhoto` → `OmOffline.api` grava a foto na fila geral e devolve `{success:true, queued:true}`. A fila de mídia conta isso como enviado e mostra o toast "Foto enviada." (`campo/dia.js:437-452`). A foto não se perde, mas a pessoa vai embora achando que ela subiu, e o base64 fica guardado em duas filas.
3. ✔ **ObraCam: a rolagem vertical trava sobre os chips.** O último commit pôs `touch-action: pan-x` em `.cam-filters`, `.cam-chips--stick` e `.cam-chips--bar` (`obracam.css:67,283,418`). Quem começa a arrastar em cima da barra de filtros não consegue rolar a página. Correção: `pan-x pan-y`.
4. ✔ **ObraCam: o "thumbnail" é a foto inteira.** `thumbUrl: stored.url` (`src/crm/routes/campo-jobs.ts:631`, `job-reports.ts:318`, `stain.ts:115`, `work-orders/public-routes.ts:316`). Cada tile de ~125px baixa um JPEG de 1280–1600px, e a lista sozinha pode passar de dezenas de MB.
5. **ObraCam: o viewer não entra no histórico.** Não há `pushState` em `cam-viewer.js`. No PWA, o botão voltar do Android sai do app em vez de fechar a foto.

---

## 1. Usabilidade, UX/UI e layout

### Problemas que se repetem em todos os apps
- **Zoom bloqueado.** `maximum-scale=1` em 37 páginas do CRM e em todas as telas do ObraCrew, o que falha WCAG 1.4.4. A causa real é ter inputs com menos de 16px (25 regras no CRM, mais `.pp-sendto select` e `.pp-it input` no Builder, e o textarea de 14,4px no ObraCrew). A correção é subir os inputs para 16px e tirar o `maximum-scale`.
- **Diálogos nativos.** O CRM tem 32 `alert`, 16 `confirm` e 3 `prompt`; o Builder tem 8. Já existem `crmConfirm`/`crm-toast` e `.pp-toast` para substituir.
- **Modais e sheets sem padrão de foco.** O CRM tem 36 implementações de modal/sheet/drawer, e só 5 devolvem o foco ao fechar. Os sheets do Builder e do ObraCrew não prendem o foco nem fecham com Esc. As alças de "arrastar" (`.pp-sheet-grab`, `.dy-sheet__grab`) não respondem ao gesto.
- **Contraste e tamanho de alvos.** `#98A2B3` sobre branco dá ~2,6:1 e é usado em datas e cabeçalhos no ObraCrew e no ObraCam. O botão terra `#E7792C` com texto branco dá ~2,9:1. O certo é usar `#B4561A`/`#B9581A`, que já são os tokens AA. Há alvos de 24–40px onde o mínimo deveria ser 44px, e 48px no campo.
- **Mistura de idiomas.** No CRM, o menu mostra "Calendar/Quotes/Invoices/Jobs" mesmo em PT, porque faltam entradas `pt` no `dictionary.json`. O ObraCam tem as fases em inglês ("Delivery, Scan, Installation…"). O ObraCrew tem PT-PT ("A carregar…") e "Ticket/Jobs" misturados com PT-BR.
- **Carregamento e vazio.** O CRM tem 41 "Carregando…" soltos e 67 classes de vazio diferentes. Já existe `crm-skeleton.js`, mas só 5 módulos usam.

### Por app

**ObraMate CRM**
1. "Início" e "Leads" levam a páginas diferentes no desktop e no celular: na sidebar Início é `/dashboard`, no dock é `home.html` (`crm-shared-nav.js:106` vs `om-mobile-nav.js:592-593`).
2. Três fontes de verdade para o mesmo menu: `crm-shared-nav.js`, `om-mobile-nav.js` e `mais.html`.
3. O menu Criar tem duas entradas, "Novo quote" e "Novo orçamento", que abrem a mesma tela (`om-mobile-nav.js:651,654`).
4. Cada módulo tem seu próprio cabeçalho de desktop (`lb-head`, board, `cfg-nav__title`…). Há duas superfícies de pipeline de leads.
5. Foco de teclado: 115 `outline:none` contra 111 `:focus-visible`.

**ObraBuilder**
1. `<main aria-live="polite">` faz o leitor de tela ler a página inteira a cada render (`partner-portal.html:62`).
2. De 768 a 1023px o dock ainda tem 10 destinos, e a ordem e os nomes diferem das tabs do celular ("Measure" vs "Measurements").
3. A busca de Docs e Measurements chama `render()` inteiro a cada tecla, com fetch, flicker e cursor pulando (`partner-portal.js:2860, 4187`).
4. O login usa outro sistema visual (`partner-portal.css` legado, Geist declarada mas nunca carregada).
5. O hover do dock não está limitado a `(hover:hover)` e fica "grudado" no iPad.

**ObraCrew**
1. O GPS espera até 9s, mas o toast some em 3,2s, e o botão não ganha estado de carregando (`dia.js:34-65`). A pessoa toca de novo.
2. Erro e sucesso usam o mesmo toast preto, e `--red` é igual à cor da marca.
3. "Enviar o dia" fica bloqueado enquanto há fotos pendentes, sem opção de enviar e sincronizar depois (`dia.js:625`).
4. O stain fica fora do app: sem tabbar, sem offline, com outro `theme-color`.
5. Jobs e Chat da tabbar saem de `/campo` para páginas do CRM.

**ObraCam**
1. Não existe compartilhar (`navigator.share`). O download em lote com `<a download>` a cada 350ms não funciona no iOS.
2. Dois fluxos de upload com visuais diferentes: `.oc-sheet` e `.cam-up`, com compressão e GPS duplicados.
3. Sem progresso por arquivo, sem fila offline, e o erro mostra a mensagem crua ("HTTP 500") sem botão de tentar de novo.
4. "Todas as fotos" mostra só os últimos 3 dias (`/board?days=3`).
5. A seleção depende de long-press de 480ms e não há nenhuma dica de que o gesto existe.

---

## 2. Padronização

### Situação atual
| | CRM | ObraBuilder | ObraCrew | ObraCam |
|---|---|---|---|---|
| Tokens | 630 `--*`, ~25 prefixos (`--om-*`, `--color-*`, `--omd-*`, `--ol-*`, `--sf`…). `styles.css` ainda tem a paleta navy/dourada antiga | `--pp-*` (bem organizados, mas com 125 hex fora deles) | `--cm-*` e, em `dia.css`, um segundo conjunto sem prefixo (`--ink`, `--terra`, `--muted` diferente) | `--cam-*` (com escopo, não chega nos sheets), `--cv-*` no viewer, hex fixo no `obracam-app.css` |
| Accent | `#E7792C` em 51 tokens + 286 literais | `--pp-orange` | `--cm-accent #B4561A` / `--terra #E7792C` | `--cam-or` |
| `!important` | 1.946 | 89 | — | 24 + overrides do shell |
| Fonte | Plus Jakarta / Inter / Poppins + Geist injetada | Geist | Plus Jakarta (Geist na página de sem acesso) | Geist + Plus Jakarta |
| Raios distintos | 108 | ~20 | 10 | 16 |
| Botões | 85 classes | `.pp-btn` + variantes | `.cm-btn`, `.dy-btn`, `.st-btn` | `.cam-btn`, `.oc-go`, `.cv-btn`, `.cv-round` |
| Sheets/modais | 36 | `.pp-sheet`, palette, lightbox | `.cm-sheet`, `.dy-sheet` | `.oc-sheet`, `.cam-up`, `.cam-selsheet`, `.cam-stkm` |
| Toasts | `crm-toast` | `.pp-toast` (2 posições) | `.dy-toast`, `.st-toast`, `crm-toast` | — |

O ponto positivo é que os quatro apps convergem nos mesmos valores de base: fundo `#F7F8FA`, tinta `#221E1A`, muted `#667085`, borda `#E5E7EB`, accent `#E7792C`/`#B4561A`, easing `cubic-bezier(0.23,1,0.32,1)` e `cubic-bezier(0.32,0.72,0,1)`. Ou seja, a identidade já existe; o que falta é ela estar num só lugar.

### Proposta
1. **Um arquivo de tokens só, `om-tokens.css`.** Seguindo o design-system (primitivo → semântico → componente), ele define:
   - cores semânticas: `--om-bg`, `--om-surface`, `--om-ink`, `--om-muted`, `--om-line`, `--om-accent`, `--om-accent-strong`, `--om-success`, `--om-danger`, `--om-warning`
   - escala de espaço (4/8/12/16/24/32)
   - raios: `--om-r-sm` 8, `--om-r-md` 12, `--om-r-lg` 18, `--om-r-pill` 999
   - fonte: 12/13/14/16/18/22/28
   - sombras: `--om-shadow-1..3`, com um tom só
   - movimento: `--om-ease-out`, `--om-ease-drawer`, `--om-dur-1..3`

   Os prefixos atuais (`--pp-*`, `--cm-*`, `--cam-*`) viram aliases que apontam para esses tokens, o que permite migrar aos poucos sem quebrar nada.
2. **Uma família de fonte.** Geist, servida localmente com `preload` e 3 pesos (400/600/700), no lugar de Plus Jakarta, Inter e Poppins.
3. **Componentes base em `om-ui.css` + `om-ui.js`**, cada um com acessibilidade embutida:
   - `om-btn` (primário, secundário, ghost, perigo; tamanhos sm/md/lg; mínimo de 44px)
   - `om-sheet` / `om-dialog` (focus trap, Esc, retorno de foco, `dvh`, `overscroll-behavior: contain`, arrastar para fechar, `pushState` para o botão voltar)
   - `om-toast` (sucesso/erro/info)
   - `om-chip`, `om-seg`, `om-skeleton`, `om-empty`
4. **Navegação a partir de uma fonte só.** Os destinos de cada app ficam num manifesto JS. Sidebar, dock, tabbar e "Mais" são gerados a partir dele. Mesma ordem e mesmos nomes no desktop e no celular, com rótulos vindos do i18n.
5. **Cabeçalho de página padrão (`om-page-head`)** com título, subtítulo, ações e filtros, usado em todas as listas e detalhes do CRM.
6. **Lint de regressão.** Um script que conta hex fora dos tokens, `!important`, `alert(`, `maximum-scale` e `outline:none` sem substituto, e roda no `npm test` para impedir que os números voltem a subir.

---

## 3. Desempenho

Ordenado por ganho em relação ao esforço:

| # | Mudança | Ganho esperado | Esforço |
|---|---|---|---|
| 1 | ✔ Ligar `compression()` (brotli/gzip) no `src/app.ts`, antes dos statics. Hoje nada é comprimido. | −70 a 78% dos bytes de JS, CSS e JSON. Dashboard: ~1,3 MB → ~320 KB | 1 linha + dependência |
| 2 | ✔ `Cache-Control: public, max-age=31536000, immutable` para pedidos com `?v=` (hoje é `no-cache`, `app.ts:114`) | A visita repetida deixa de fazer 30 a 60 viagens de 304 | Pequeno |
| 3 | Thumbnails de verdade (256 e 640px) gerados no upload, mais `<img loading="lazy" decoding="async" srcset>` no lugar de `background-image` | Lista do ObraCam 10 a 50× mais leve | Médio |
| 4 | Polling ciente de visibilidade: `notification-center.js:514` (20s, ~360 req/h por aba) e `chat/unread` (45s). Subir para 60s e pausar quando a aba está oculta | −80% dessas requisições | Pequeno |
| 5 | Unificar versões: `styles.css` em duas `?v=`, `crm-toast.js` e `saas-branding.js` baixados duas vezes. Uma constante de versão gerada no build | Fim dos downloads duplicados | Pequeno |
| 6 | Enxugar APIs: `/api/leads?limit=5000` no celular, overview sem LIMIT e com `notes`, resumo de quotes lendo o `payload` JSON de 5000 linhas, board do ObraCam com `lineItems`/`invoices` e um `resolveJobSiteGeo` N+1 que escreve no banco dentro de um GET | Primeira tela mais rápida, menos carga no banco | Médio |
| 7 | Índices: `Lead(organizationId, createdAt)`, `Quote(organizationId, leadId, createdAt)`, `JobMedia(organizationId, type, deletedAt, createdAt)`, `WorkOrder(organizationId, status, scheduledStart)` | Consultas da primeira tela | Pequeno (migração) |
| 8 | Service worker: hoje é network-first para tudo, o que deixa o campo lento com sinal fraco. Passar a cache-first para `?v=`, stale-while-revalidate para `/api/campo`, `navigationPreload`, limpeza de caches velhos e um PRECACHE que bata com o que as páginas pedem | Campo usável com sinal fraco | Médio |
| 9 | Carregar sob demanda: `partner-portal-takeoff.js` + `3d.js` (158 KB) só em Measurements; `mate-panel` (154 KB) ao abrir o Mate; Leaflet local e só quando o mapa abre; `crm-job-modal.js` (181 KB) no ObraCam | −150 a 300 KB por página | Médio |
| 10 | Bundling e minificação com esbuild no `build` (de ~30 para ~5 requisições por página); remover o Tailwind via CDN do quote-builder; `defer` nos scripts do `<head>` | −35% sobre o gzip, melhor FCP | Médio/alto |

Também vale fazer:
- No ObraBuilder, a busca pede debounce de 200ms com filtro local, sem re-render inteiro.
- No ObraCrew e no ObraCam, guardar a foto como Blob e enviar multipart, com uma função de compressão só no lugar das três atuais.
- Reduzir `backdrop-filter` em elementos fixos: 64 no CRM, 13 no Builder.

---

## 4. Animações e interatividade

**O que já está bom:** já existem tokens de movimento (`--om-ease-out`, `--om-dur-1..3`, `--pp-ease-drawer`). Os gestos do viewer do ObraCam são bons (pinch com rubber-band, momentum, swipe). O Builder já tem stagger de entrada e skeleton.

**O que corrigir:**
- **Reduced-motion zerando tudo.** CRM (`om-theme.css:26-34`), Builder e viewer zeram as animações com `0.01ms !important`, o que mata também o feedback útil. O ObraCam e parte do ObraCrew nem têm a regra. O padrão deveria ser: em reduced-motion, tirar os `transform` e manter fade de 150ms.
- **Animações de layout.** A sidebar anima `width`/`margin-left` (`crm-shell.css:631`); as barras de progresso animam `width`; o shimmer anima `background-position`. Trocar por `transform: scaleX()`/`translate`.
- **Animações que não deveriam existir.** A command palette do Builder é aberta pelo teclado e deveria abrir sem animação. O menu Criar entra com overshoot de `scale(.85)` e sai sem transição.
- **Nenhum sheet, modal ou toast tem animação de saída.** Todos usam `hidden`/`remove()` e somem de uma vez.
- O mascote da Home leva 0,6s com 0,15s de atraso a cada carregamento.

**Padrão proposto**, embutido nos componentes base da seção 2. Tudo anima só `transform` e `opacity`:

| Interação | Movimento |
|---|---|
| Toque em botões, itens de dock/tabbar e cards | `:active { transform: scale(.97) }`, 120ms `--om-ease-out` |
| Sheet (celular) | Entrada `translateY(100%)→0` em 300ms `cubic-bezier(.32,.72,0,1)`; saída 240ms; backdrop com opacity 200ms; arrastar para fechar (>25% da altura ou velocidade >0,11px/ms) |
| Modal / dialog (desktop) | `@starting-style` com `opacity 0` + `scale(.97)`, 200ms; saída 150ms |
| Menus / pulldown | `scale(.96)` + opacity, 160ms, origem no gatilho; saída 120ms; sem overshoot |
| Toast | Entrada com `translateY(8px)` + opacity, 200ms; saída simétrica 150ms; cor por tipo |
| Skeleton → conteúdo | Crossfade de 150ms, sem translate |
| Viewer do ObraCam | FLIP do tile para a tela cheia, 280ms; ao soltar o swipe-down, a foto segue na velocidade do dedo; a thumb aparece na hora e a foto cheia entra com crossfade de 150ms |
| Seleção de fotos | Check de `scale(.6)→1` em 160ms; a barra de seleção sobe em 240ms |
| Botão em espera (GPS, envio) | Estado `is-busy`: o texto some e entra um spinner de 18px; o botão fica desabilitado |
| ObraCrew | `navigator.vibrate(12)` ao tocar em Começar/Finalizar/Enviar o dia, e `[20,40,20]` quando o servidor confirma |
| Momentos raros (dia enviado, Send work concluído) | Mascote/check com `scale(.96→1)` + opacity, 300ms, uma vez |

**Rejeitadas de propósito** (são telas ou ações usadas dezenas de vezes por dia, ou dados que a pessoa está lendo):
- troca de abas no dock/tabbar
- chips de filtro
- stagger em listas e no grid a cada filtro
- contagem animada de KPI e relógio
- hover-lift no kanban
- gráficos de relatório
- animação da sidebar

---

## Roadmap sugerido

| Fase | Conteúdo | Por que nesta ordem |
|---|---|---|
| **0. Bugs** (1–2 dias) | Itens 1 a 5 da seção 0 | Afetam o campo e a confiança nos dados hoje |
| **1. Desempenho rápido** (1–2 dias) | Desempenho 1, 2, 4, 5 e 7 | Ganho grande, pouco risco, beneficia todos os apps de uma vez |
| **2. Fundação** (1 semana) | `om-tokens.css` com aliases, uma fonte, `om-ui` (btn, sheet, dialog, toast, skeleton) já com as animações padrão e a acessibilidade, manifesto de navegação, lint de regressão | É a base que torna as fases 3 e 4 rápidas e consistentes |
| **3. Migração por app** (1 semana por app) | Ordem: ObraCrew → ObraCam → ObraBuilder → CRM (do menor para o maior). Em cada um: trocar os componentes, corrigir zoom, contraste, alvos e diálogos nativos, idioma, estados de carregamento e vazio | Os apps menores validam o sistema antes do CRM |
| **4. Desempenho estrutural** | Thumbnails, enxugar APIs, service worker, carregar sob demanda, esbuild | Exige migração e mais testes |
| **5. Polimento de movimento** | FLIP do viewer, arrastar para fechar, haptics, momentos raros | Depende dos componentes base |

## Limites
- Nada foi testado em navegador nem em aparelho. Toque real, sol forte, zoom no iOS e desempenho em Android modesto precisam ser confirmados num celular.
- Os bytes da tabela de desempenho são estimativas a partir do tamanho dos arquivos.
- Vale confirmar em produção se existe compressão na frente do app (`curl -I -H 'Accept-Encoding: br,gzip'`).
