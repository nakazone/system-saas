# 📦 Instalação do CRM Completo

## ⚠️ Importante: Migração Necessária

Se você já tem tabelas no banco (do sistema antigo PHP), precisa executar a migração primeiro!

---

## Passo 1: Migrar pipeline_stages

A tabela `pipeline_stages` precisa ter a coluna `slug`. Execute:

```bash
railway run node database/migrate-pipeline-stages.js
```

**O que este script faz:**
- ✅ Adiciona coluna `slug` se não existir
- ✅ Adiciona índice único para `slug`
- ✅ Gera slugs para estágios existentes
- ✅ Adiciona colunas novas (`order_num`, `sla_hours`, `required_actions`, `required_fields`, `is_closed`)
- ✅ Marca estágios finais (`closed_won`, `closed_lost`)

---

## Passo 2: Executar Schema Completo

Após a migração, execute o schema completo:

```bash
railway run node database/run-schema-crm-completo.js
```

**O que este script faz:**
- ✅ Cria todas as tabelas novas (se não existirem)
- ✅ Ignora erros de tabelas já existentes
- ✅ Insere estágios do pipeline padrão (se não existirem)

---

## Verificação

Após executar ambos os scripts, verifique:

1. **Tabelas criadas:**
   ```sql
   SHOW TABLES LIKE '%qualification%';
   SHOW TABLES LIKE '%measurement%';
   SHOW TABLES LIKE '%proposal%';
   ```

2. **Pipeline stages:**
   ```sql
   SELECT id, name, slug, order_num, is_closed FROM pipeline_stages ORDER BY order_num;
   ```

3. **Estrutura de pipeline_stages:**
   ```sql
   SHOW COLUMNS FROM pipeline_stages;
   ```
   
   Deve ter: `slug`, `order_num`, `sla_hours`, `required_actions`, `required_fields`, `is_closed`

---

## Troubleshooting

### Erro: "Unknown column 'slug'"

**Causa:** Tabela `pipeline_stages` existe mas não tem coluna `slug`.

**Solução:** Execute primeiro `migrate-pipeline-stages.js` antes de `run-schema-crm-completo.js`.

---

### Erro: "Duplicate key 'slug'"

**Causa:** Índice único já existe.

**Solução:** O script já ignora esse erro. Pode continuar.

---

### Erro: "Table already exists"

**Causa:** Tabela já foi criada anteriormente.

**Solução:** Normal, o script ignora esse erro. As tabelas novas serão criadas.

---

## Ordem Correta de Execução

1. ✅ `migrate-pipeline-stages.js` (migra tabela existente)
2. ✅ `run-schema-crm-completo.js` (cria tabelas novas)

---

## Próximos Passos

Após instalar o schema:
1. ✅ Verificar se todas as tabelas foram criadas
2. ✅ Testar as APIs (`/api/leads/:id/qualification`, etc.)
3. ✅ Começar a criar o frontend
