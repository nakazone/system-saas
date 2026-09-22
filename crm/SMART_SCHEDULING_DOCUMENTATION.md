# 🎯 Smart Scheduling & Crew Allocation Engine - Documentation

## 📋 Overview

Sistema completo de agendamento inteligente e alocação de equipes para otimizar:
- Disponibilidade de equipes
- Rentabilidade
- Produtividade
- Prazo de entrega
- Alocação de recursos

---

## 🗄️ Database Structure

### Tables Created

#### 1. **crews**
Equipes de trabalho.

**Key Fields:**
- `name` - Nome da equipe
- `crew_leader_id` - Líder da equipe (FK users)
- `crew_members` - Array de IDs de membros (JSON)
- `specializations` - Tipos de piso que trabalham (JSON)
- `base_productivity_sqft_per_day` - Produtividade base
- `max_daily_capacity_sqft` - Capacidade máxima diária

#### 2. **project_schedules**
Agendamentos de projetos.

**Key Fields:**
- `project_id` - FK projects
- `crew_id` - FK crews
- `start_date` / `end_date` - Datas de início/fim
- `estimated_days` - Dias estimados
- `total_sqft` / `allocated_sqft` - Metragem
- `status` - scheduled | in_progress | completed | delayed | cancelled
- `priority` - low | normal | high
- `locked` - Bloqueado para ajustes automáticos
- `projected_profit` / `projected_margin` - Projeções financeiras
- `delay_risk_level` - low | medium | high

#### 3. **crew_availability**
Disponibilidade diária das equipes.

**Key Fields:**
- `crew_id` - FK crews
- `date` - Data
- `status` - available | booked | unavailable | maintenance
- `daily_capacity_sqft` - Capacidade do dia
- `allocated_sqft` - Metragem alocada
- `is_overbooked` - Flag de sobrecarga

#### 4. **crew_performance_stats**
Estatísticas de performance das equipes.

**Key Fields:**
- `crew_id` - FK crews
- `period_start` / `period_end` - Período
- `avg_productivity_sqft_per_day` - Produtividade média
- `avg_delay_percentage` - Percentual médio de atraso
- `avg_profit_margin` - Margem de lucro média
- `projects_completed` - Projetos completados

#### 5. **schedule_adjustments**
Histórico de ajustes de agendamento.

**Key Fields:**
- `project_schedule_id` - FK project_schedules
- `adjustment_type` - delay | shift | reallocate | cancel
- `original_start_date` / `original_end_date`
- `new_start_date` / `new_end_date`
- `auto_applied` - Se foi aplicado automaticamente

### Schema File
Execute: `database/schema-schedule-engine.sql`

---

## 🧮 Smart Allocation Engine

### Core Functions (`services/scheduleAllocator.js`)

#### **calculateEstimatedDays(totalSqft, crewProductivity)**
Calcula dias estimados baseado na produtividade.
```
estimated_days = ceil(total_sqft / crew_productivity)
```

#### **findAvailableCrews(pool, flooringType, startDate, endDate)**
Encontra equipes disponíveis compatíveis:
- Verifica especialização (tipo de piso)
- Verifica disponibilidade no período
- Retorna equipes com estatísticas

#### **simulateSchedule(pool, projectId, totalSqft, flooringType, priority)**
Simula agendamento e retorna top 3 opções ranqueadas.

**Score Formula:**
```
score = (profit_weight × projected_margin)
      + (speed_weight × delivery_speed)
      - (risk_weight × delay_risk)
```

**Pesos padrão:**
- `profit_weight` = 0.4 (40%)
- `speed_weight` = 0.3 (30%)
- `risk_weight` = 0.3 (30%)

#### **checkAndFlagOverbooking(pool, crewId, date, allocatedSqft)**
Verifica e marca sobrecarga:
- Compara `allocated_sqft` com `max_daily_capacity_sqft`
- Marca `is_overbooked = 1` se exceder capacidade
- Atualiza `crew_availability`

---

## 🔌 API Routes

### Base URLs: `/api/crews`, `/api/schedules`

#### **GET /api/crews**
Lista equipes com estatísticas.

**Query Parameters:**
- `active` - Filtrar por ativas (true/false)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Crew Alpha",
      "current_productivity": 520.5,
      "avg_delay_percentage": 5.2,
      "avg_profit_margin": 28.5,
      "projects_completed": 15
    }
  ]
}
```

#### **POST /api/crews**
Criar nova equipe.

**Body:**
```json
{
  "name": "Crew Delta",
  "crew_leader_id": 5,
  "crew_members": [5, 6, 7],
  "specializations": ["hardwood", "lvp"],
  "base_productivity_sqft_per_day": 550,
  "max_daily_capacity_sqft": 850
}
```

#### **GET /api/schedules**
Lista agendamentos.

**Query Parameters:**
- `crew_id` - Filtrar por equipe
- `project_id` - Filtrar por projeto
- `status` - Filtrar por status
- `start_date` / `end_date` - Filtrar por período

#### **POST /api/schedules**
Criar agendamento.

**Body:**
```json
{
  "project_id": 1,
  "crew_id": 2,
  "start_date": "2024-03-01",
  "end_date": "2024-03-05",
  "priority": "high",
  "locked": false
}
```

#### **POST /api/schedules/simulate**
Simula agendamento e retorna top 3 opções.

**Body:**
```json
{
  "project_id": 1,
  "flooring_type": "hardwood",
  "priority": "normal"
}
```

**Response:**
```json
{
  "success": true,
  "options": [
    {
      "crew_id": 1,
      "crew_name": "Crew Alpha",
      "start_date": "2024-03-01",
      "end_date": "2024-03-05",
      "estimated_days": 4,
      "projected_profit": 2500.00,
      "projected_margin": 28.5,
      "delay_risk_level": "low",
      "score": 85.2
    }
  ],
  "total_options": 5
}
```

#### **GET /api/crews/:crewId/availability**
Obtém disponibilidade da equipe.

**Query Parameters:**
- `start_date` - Data inicial (padrão: hoje)
- `end_date` - Data final (padrão: +90 dias)

---

## 🎨 Frontend Interface

### Schedule Page (`schedule-engine.js`)

**Views Disponíveis:**

1. **Month View** 📅
   - Calendário mensal completo
   - Agendamentos exibidos por dia
   - Cores por status
   - Indicadores de prioridade

2. **Week View** 📆
   - Visualização semanal
   - Timeline detalhada
   - Slots de tempo

3. **Crew Timeline** 👥
   - Timeline por equipe
   - Lista de projetos por equipe
   - Status e ações

**Forecast Dashboard:**
- Monthly Capacity (metragem total)
- Revenue Forecast (receita projetada)
- Profit Forecast (lucro projetado)
- Crew Utilization (utilização %)

---

## 🔄 Workflow

### Quando Estimate é Aceito:

1. **Trigger:** Estimate status → "accepted"
2. **Calcular:** `estimated_days = total_sqft / crew_productivity`
3. **Simular:** Chamar `/api/schedules/simulate`
4. **Receber:** Top 3 opções ranqueadas
5. **Escolher:** Selecionar melhor opção
6. **Criar:** POST `/api/schedules` com opção escolhida
7. **Verificar:** Sistema marca sobrecarga automaticamente

### Proteção contra Sobrecarga:

- Sistema verifica `allocated_sqft > max_daily_capacity_sqft`
- Marca `is_overbooked = 1` em `crew_availability`
- Avisa mas permite (a menos que `locked = 1`)

### Ajustes Dinâmicos:

- Se projeto atrasa: sistema pode sugerir re-alocação
- Auto-shift: projetos futuros podem ser deslocados
- Histórico: todos os ajustes são registrados em `schedule_adjustments`

---

## 📊 Visual Indicators

### Cores por Status:
- **scheduled** - Azul claro (#e3f2fd)
- **in_progress** - Laranja claro (#fff3e0)
- **completed** - Verde claro (#e8f5e9)
- **delayed** - Vermelho claro (#ffebee)
- **cancelled** - Roxo claro (#f3e5f5)

### Cores por Prioridade:
- **high** - Vermelho (#f44336)
- **normal** - Azul (#2196f3)
- **low** - Verde (#4caf50)

### Indicadores:
- ⚠️ Sobrecarregado (overbooked)
- 💰 Nível de margem (cor)
- 🚩 Risco de atraso (flag)

---

## 🚀 Setup Instructions

### 1. Database Setup

```bash
# Execute o schema
mysql -h [HOST] -u [USER] -p [DATABASE] < database/schema-schedule-engine.sql

# Ou via Node.js
node database/run-schema-schedule-engine.js
```

### 2. Criar Equipes Iniciais

```sql
INSERT INTO crews (name, base_productivity_sqft_per_day, max_daily_capacity_sqft, specializations) VALUES
('Crew Alpha', 500, 800, '["hardwood", "engineered", "lvp"]'),
('Crew Beta', 450, 750, '["tile", "laminate"]');
```

### 3. Test API

```bash
# List crews
curl http://localhost:3000/api/crews

# Simulate schedule
curl -X POST http://localhost:3000/api/schedules/simulate \
  -H "Content-Type: application/json" \
  -d '{"project_id": 1, "flooring_type": "hardwood"}'

# Create schedule
curl -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{"project_id": 1, "crew_id": 1, "start_date": "2024-03-01", "end_date": "2024-03-05"}'
```

---

## 🔮 Future Extensions

O sistema está preparado para:

- ✅ **Time Tracking Integration** - Rastreamento de tempo real
- ✅ **Real Productivity Learning** - Aprendizado de produtividade real
- ✅ **AI-based Duration Prediction** - Predição de duração com IA
- ✅ **Route Optimization** - Otimização de rotas
- ✅ **Multi-crew Projects** - Projetos com múltiplas equipes

---

## 📝 Best Practices

1. **Sempre simular antes de agendar** - Use `/api/schedules/simulate`
2. **Verificar sobrecarga** - Sistema avisa automaticamente
3. **Bloquear agendamentos críticos** - Use `locked = 1`
4. **Monitorar performance** - Stats são atualizados automaticamente
5. **Ajustar quando necessário** - Sistema suporta re-alocação

---

## 🐛 Troubleshooting

### Schedule não aparece no calendário?
- Verifique se `start_date` e `end_date` estão no período visualizado
- Confirme que o status não é "cancelled"

### Simulação não retorna opções?
- Verifique se há equipes ativas compatíveis
- Confirme que o tipo de piso está nas especializações
- Verifique disponibilidade no período

### Sobrecarga não detectada?
- Confirme que `max_daily_capacity_sqft` está configurado
- Verifique se `allocated_sqft` está sendo atualizado

---

## 📞 Support

Para mais detalhes, consulte:
- API Documentation: `/api/schedules` e `/api/crews` endpoints
- Frontend Code: `public/schedule-engine.js`
- Allocation Logic: `services/scheduleAllocator.js`
