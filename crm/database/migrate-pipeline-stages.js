/**
 * Migração: Adicionar coluna 'slug' à tabela pipeline_stages
 * e atualizar os dados existentes
 */

import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getMySQLConfig() {
  if (process.env.DATABASE_PUBLIC_URL) {
    const url = new URL(process.env.DATABASE_PUBLIC_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 3306,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
    };
  }

  if (process.env.RAILWAY_TCP_PROXY_DOMAIN && process.env.RAILWAY_TCP_PROXY_PORT) {
    return {
      host: process.env.RAILWAY_TCP_PROXY_DOMAIN,
      port: parseInt(process.env.RAILWAY_TCP_PROXY_PORT),
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQLDATABASE || 'railway',
    };
  }

  if (process.env.MYSQLHOST) {
    return {
      host: process.env.MYSQLHOST,
      port: parseInt(process.env.MYSQLPORT) || 3306,
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQLDATABASE || 'railway',
    };
  }

  if (process.env.DB_HOST) {
    return {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    };
  }

  throw new Error('MySQL connection variables not found.');
}

// Mapeamento de nomes para slugs
const nameToSlug = {
  'Lead Recebido': 'lead_received',
  'Contato Realizado': 'contact_made',
  'Qualificado': 'qualified',
  'Visita Agendada': 'visit_scheduled',
  'Medição Realizada': 'measurement_done',
  'Proposta Criada': 'proposal_created',
  'Proposta Enviada': 'proposal_sent',
  'Em Negociação': 'negotiation',
  'Fechado - Ganhou': 'closed_won',
  'Fechado - Perdido': 'closed_lost',
  'Produção / Obra': 'production',
  'Novo Lead': 'lead_received',
  'Qualificação': 'qualified',
  'Proposta': 'proposal_sent',
  'Negociação': 'negotiation',
  'Fechado': 'closed_won',
  'Perdido': 'closed_lost',
};

function generateSlug(name) {
  // Se já existe no mapeamento, usar
  if (nameToSlug[name]) {
    return nameToSlug[name];
  }
  
  // Caso contrário, gerar slug a partir do nome
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function main() {
  console.log('🔄 Migrando tabela pipeline_stages...\n');

  const config = getMySQLConfig();
  console.log(`📊 Conectando ao MySQL...`);
  console.log(`   Host: ${config.host}`);
  console.log(`   Database: ${config.database}\n`);

  let connection;
  try {
    connection = await mysql.createConnection(config);
    console.log('✅ Conectado ao MySQL\n');

    // Verificar se a coluna slug já existe
    const [columns] = await connection.execute(
      "SHOW COLUMNS FROM pipeline_stages LIKE 'slug'"
    );

    if (columns.length === 0) {
      console.log('📝 Adicionando coluna slug...');
      await connection.execute(
        "ALTER TABLE pipeline_stages ADD COLUMN slug VARCHAR(50) NULL AFTER name"
      );
      console.log('✅ Coluna slug adicionada\n');
    } else {
      console.log('✅ Coluna slug já existe\n');
    }

    // Verificar se precisa adicionar índice único
    const [indexes] = await connection.execute(
      "SHOW INDEXES FROM pipeline_stages WHERE Key_name = 'slug'"
    );

    if (indexes.length === 0) {
      console.log('📝 Adicionando índice único para slug...');
      try {
        await connection.execute(
          "ALTER TABLE pipeline_stages ADD UNIQUE KEY slug (slug)"
        );
        console.log('✅ Índice único adicionado\n');
      } catch (error) {
        if (!error.message.includes('Duplicate')) {
          throw error;
        }
        console.log('⚠️  Índice já existe\n');
      }
    }

    // Buscar todos os estágios
    const [stages] = await connection.execute(
      "SELECT id, name FROM pipeline_stages WHERE slug IS NULL OR slug = ''"
    );

    if (stages.length > 0) {
      console.log(`📝 Atualizando ${stages.length} estágios com slugs...\n`);
      
      for (const stage of stages) {
        const slug = generateSlug(stage.name);
        await connection.execute(
          "UPDATE pipeline_stages SET slug = ? WHERE id = ?",
          [slug, stage.id]
        );
        console.log(`   ${stage.id}. ${stage.name} → ${slug}`);
      }
      console.log('\n✅ Slugs atualizados\n');
    } else {
      console.log('✅ Todos os estágios já têm slug\n');
    }

    // Verificar se precisa adicionar outras colunas do novo schema
    const [allColumns] = await connection.execute(
      "SHOW COLUMNS FROM pipeline_stages"
    );
    const columnNames = allColumns.map(col => col.Field);

    const newColumns = [];
    if (!columnNames.includes('order_num')) {
      newColumns.push({ name: 'order_num', sql: "ADD COLUMN order_num INT(11) DEFAULT 0 AFTER slug" });
    }
    if (!columnNames.includes('sla_hours')) {
      newColumns.push({ name: 'sla_hours', sql: "ADD COLUMN sla_hours INT(11) DEFAULT NULL AFTER color" });
    }
    if (!columnNames.includes('required_actions')) {
      newColumns.push({ name: 'required_actions', sql: "ADD COLUMN required_actions JSON DEFAULT NULL AFTER sla_hours" });
    }
    if (!columnNames.includes('required_fields')) {
      newColumns.push({ name: 'required_fields', sql: "ADD COLUMN required_fields JSON DEFAULT NULL AFTER required_actions" });
    }
    if (!columnNames.includes('is_closed')) {
      newColumns.push({ name: 'is_closed', sql: "ADD COLUMN is_closed TINYINT(1) DEFAULT 0 COMMENT '1=estágio final (ganhou/perdeu)' AFTER required_fields" });
    }

    if (newColumns.length > 0) {
      console.log(`📝 Adicionando ${newColumns.length} colunas novas...\n`);
      for (const col of newColumns) {
        try {
          await connection.execute(`ALTER TABLE pipeline_stages ${col.sql}`);
          console.log(`   ✅ ${col.name} adicionada`);
        } catch (error) {
          console.log(`   ⚠️  ${col.name}: ${error.message}`);
        }
      }
      console.log('');
    }

    // Atualizar order_num se estiver usando 'order' ao invés de 'order_num'
    if (columnNames.includes('order') && !columnNames.includes('order_num')) {
      console.log('📝 Migrando coluna order → order_num...');
      try {
        await connection.execute(
          "ALTER TABLE pipeline_stages CHANGE COLUMN `order` order_num INT(11) DEFAULT 0"
        );
        console.log('✅ Migração concluída\n');
      } catch (error) {
        if (error.message.includes('Duplicate column')) {
          console.log('⚠️  Coluna order_num já existe, pulando migração\n');
        } else {
          throw error;
        }
      }
    } else if (columnNames.includes('order') && columnNames.includes('order_num')) {
      // Se ambas existem, copiar dados de order para order_num e remover order
      console.log('📝 Copiando dados de order para order_num e removendo order...');
      try {
        await connection.execute(
          "UPDATE pipeline_stages SET order_num = `order` WHERE order_num = 0 OR order_num IS NULL"
        );
        await connection.execute(
          "ALTER TABLE pipeline_stages DROP COLUMN `order`"
        );
        console.log('✅ Coluna order removida\n');
      } catch (error) {
        console.log(`⚠️  Erro ao migrar order: ${error.message}\n`);
      }
    }

    // Verificar estágios finais e marcar is_closed
    console.log('📝 Marcando estágios finais (is_closed)...');
    await connection.execute(
      "UPDATE pipeline_stages SET is_closed = 1 WHERE slug IN ('closed_won', 'closed_lost')"
    );
    console.log('✅ Estágios finais marcados\n');

    // Listar estágios atualizados
    const [finalStages] = await connection.execute(
      "SELECT id, name, slug, order_num, is_closed FROM pipeline_stages ORDER BY order_num, id"
    );
    
    console.log('📋 Estágios do pipeline:');
    finalStages.forEach(stage => {
      const closed = stage.is_closed ? ' [FINAL]' : '';
      console.log(`   ${stage.order_num || stage.id}. ${stage.name} (${stage.slug})${closed}`);
    });

    console.log('\n✅ Migração concluída com sucesso!');

  } catch (error) {
    console.error('\n❌ Erro:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main();
