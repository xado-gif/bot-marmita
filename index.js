require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const WPPConnect = require('@wppconnect-team/wppconnect');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- CONFIGURAÇÕES ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getModel('gemini-pro');

// --- FUNÇÕES DO BANCO ---

// Buscar ingrediente
async function buscarIngrediente(nome) {
    const { data } = await supabase
        .from('ingredientes')
        .select('*')
        .ilike('nome', `%${nome}%`);
    return data;
}

// Atualizar custo
async function atualizarCusto(nome, novoCusto) {
    const { data: existentes } = await supabase
        .from('ingredientes')
        .select('id')
        .ilike('nome', `%${nome}%`);

    if (existentes && existentes.length > 0) {
        await supabase
            .from('ingredientes')
            .update({ custo: novoCusto })
            .eq('id', existentes[0].id);
        return "Custo atualizado com sucesso!";
    } else {
        await supabase
            .from('ingredientes')
            .insert({ nome: nome, custo: novoCusto, unidade: 'un' });
        return "Novo ingrediente cadastrado!";
    }
}

// Registrar venda
async function registrarVenda(produto, valorVenda, custoProducao) {
    const { data, error } = await supabase
        .from('vendas')
        .insert([{ 
            produto: produto, 
            valor_venda: valorVenda, 
            custo_producao: custoProducao 
        }]);

    if (error) return "Erro ao salvar venda.";
    
    const lucro = valorVenda - custoProducao;
    return `Venda registrada!\nProduto: ${produto}\nVenda: R$ ${valorVenda}\nCusto: R$ ${custoProducao}\nLucro: R$ ${lucro}`;
}

// Buscar relatórios
async function gerarRelatorio() {
    const { data: vendas } = await supabase.from('vendas').select('*');
    const { data: ingredientes } = await supabase.from('ingredientes').select('*');

    let fat = 0, cust = 0;
    vendas.forEach(v => { fat += v.valor_venda; cust += v.custo_producao; });
    const lucro = fat - cust;
    const margem = fat > 0 ? ((lucro / fat) * 100).toFixed(1) : 0;

    return `
📊 *RELATÓRIO FINANCEIRO*

💰 Faturamento: R$ ${fat.toFixed(2)}
📉 Custos: R$ ${cust.toFixed(2)}
✅ Lucro: R$ ${lucro.toFixed(2)}
📈 Margem: ${margem}%

🥦 Ingredientes cadastrados: ${ingredientes.length}
    `.trim();
}

// --- INTELIGÊNCIA ARTIFICIAL ---

async function processarComando(mensagem) {
    const prompt = `
    Você é um assistente de gestão para um delivery de marmitas.
    Analise a mensagem do usuário e determine a ação.

    Mensagem: "${mensagem}"

    Regras:
    1. Se for pedido para alterar/cadastrar custo de ingrediente (ex: "altera custo arroz 5" ou "cadastra tomate 10"), retorne no formato: ACAO:ATUALIZAR_CUSTO|ITEM:arroz|VALOR:5
    2. Se for pedido para registrar venda (ex: "venda marmita 30 custo 18"), retorne: ACAO:REGISTRAR_VENDA|PRODUTO:marmita|VALOR:30|CUSTO:18
    3. Se for pedido relatório ou análise, retorne: ACAO:RELATORIO
    4. Se não entender, retorne: ACAO:NAO_ENTENDI

    Responda APENAS com o código formatado acima.
    `;

    try {
        const result = await model.generateContent(prompt);
        const resposta = result.response.text().trim();
        console.log("IA decidiu:", resposta);
        return resposta;
    } catch (e) {
        console.log("Erro na IA:", e);
        return "ACAO:NAO_ENTENDI";
    }
}

// --- INICIALIZAÇÃO DO WHATSAPP ---

WPPConnect.create({
    session: 'bot-marmitas',
    headless: true,
    useChrome: true,
    devtools: false,
})
.then((client) => start(client));

function start(client) {
    console.log('🤖 Bot iniciado! Escaneie o QR Code se necessário.');

    client.onMessage((message) => {
        // Ignorar mensagens de grupos ou audios/imagens
        if (message.isGroupMsg || message.type !== 'chat') return;
        
        // Ignorar próprias mensagens (se configurado)
        if (message.from === process.env.SEU_NUMERO) return;

        const texto = message.body.toLowerCase();

        (async () => {
            const decisao = await processarComando(message.body);
            
            // Parse da decisão da IA
            if (decisao.includes('ACAO:ATUALIZAR_CUSTO')) {
                const partes = decisao.split('|');
                const item = partes[1].replace('ITEM:', '').trim();
                const valor = parseFloat(partes[2].replace('VALOR:', '').trim());
                const resp = await atualizarCusto(item, valor);
                client.sendText(message.from, resp);
            } 
            else if (decisao.includes('ACAO:REGISTRAR_VENDA')) {
                const partes = decisao.split('|');
                const produto = partes[1].replace('PRODUTO:', '').trim();
                const valor = parseFloat(partes[2].replace('VALOR:', '').trim());
                const custo = parseFloat(partes[3].replace('CUSTO:', '').trim());
                const resp = await registrarVenda(produto, valor, custo);
                client.sendText(message.from, resp);
            }
            else if (decisao.includes('ACAO:RELATORIO')) {
                const resp = await gerarRelatorio();
                client.sendText(message.from, resp);
            }
            else {
                // Mensagemoa de menu de ajuda
                client.sendText(message.from, `Olá! Sou seu assistente de gestão.\n\nComandos disponíveis:\n• "Altera custo arroz 5" (Custo)\n• "Venda marmita 30 custo 18" (Venda)\n• "Relatório" (Dados)`);
            }
        })();
    });
}