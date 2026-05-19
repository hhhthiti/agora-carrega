# WMS Logística

Sistema operacional de gestão de cargas com integração Supabase.

## Como subir na Vercel (100% online, sem instalar nada)

### 1. Suba para o GitHub

1. Crie uma conta em [github.com](https://github.com)
2. Clique em **New repository** → nome: `wms-logistica` → **Create repository**
3. Na página do repositório, clique em **uploading an existing file**
4. Suba **todos** os arquivos desta pasta mantendo a estrutura:
   ```
   wms-logistica/
   ├── index.html
   ├── package.json
   ├── vite.config.js
   ├── public/
   │   └── favicon.svg
   └── src/
       ├── main.jsx
       └── App.jsx
   ```

### 2. Conecte na Vercel

1. Acesse [vercel.com](https://vercel.com) e faça login com sua conta GitHub
2. Clique em **Add New → Project**
3. Selecione o repositório `wms-logistica`
4. As configurações já são detectadas automaticamente:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Clique em **Deploy**
6. Em ~2 minutos você terá um link público tipo `wms-logistica.vercel.app`

### 3. Multi-usuário

O sistema já suporta múltiplos usuários simultâneos! O Supabase Realtime (WebSocket) sincroniza as mudanças de status em tempo real entre todos os navegadores abertos.

## Banco de dados

Execute o arquivo `wms-setup.sql` no **SQL Editor** do painel Supabase (já configurado no projeto).

## Atalhos de teclado

| Atalho | Ação |
|--------|------|
| Ctrl+D | Importar Agenda |
| Ctrl+M | Cadastro manual de DT |
| Ctrl+Y | Merge de PDFs |
| Ctrl+O | Ver logs |
