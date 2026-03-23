require('dotenv').config();

const express = require("express");
const fs = require("fs");

const { createClient } = require('@supabase/supabase-js');
const WPPConnect = require('@wppconnect-team/wppconnect');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// =============================
// SERVIDOR WEB (para mostrar QR)
// =============================

const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeBase64 = null;

app.get("/", (req, res) => {
    res.send("🤖 Bot Marmitas rodando!");
});

app.get("/qr", (req, res) => {

    if (!qrCodeBase64) {
        return res.send("QR ainda não foi gerado. Aguarde o bot iniciar.");
    }

    res.send(`
        <html>
            <body style="text-align:center;font-family:sans-serif">
                <h2>Escaneie o QR Code</h2>
                <img src="${qrCodeBase64}" />
            </body>
        </html>
    `);

});

app.listen(PORT, () => {
    console.log("🌐 Servidor web rodando na porta", PORT);
});

// =============================
// CONFIGURAÇÕES
// =============================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

console.log("SUPABASE_URL:", supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// =============================
// FUNÇÕES DO BANCO
// =============================

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
            .insert({
                nome: nome,
                custo: novoCusto,
                unidade: 'un'
            });

        return "Novo ingrediente cadastrado!";
    }
}

// Registrar venda
async function registrarVenda(produto, valorVenda, custoProducao) {

    const { error } = await supabase
        .from('vendas')
        .insert([{
            produto: produto,
            valor_venda: valorVenda,
            custo_producao: custoProducao
        }]);

    if (error) {
        console.log(error);
        return "Erro ao salvar venda.";
    }

    const lucro = valorVenda - custoProducao;

    return `Venda registrada!
Produto: ${produto}
Venda: R$ ${valorVenda}
Custo: R$ ${custoProducao}
Lucro: R$ ${lucro}`;
}

// Relatório
async function gerarRelatorio() {

    const { data: vendas } = await supabase
        .from('vendas')
        .select('*');

    const { data: ingredientes } = await supabase
        .from('ingredientes')
        .select('*');

    let faturamento = 0;
    let custos = 0;

    vendas.forEach(v => {
        faturamento += v.valor_venda;
        custos += v.custo_producao;
    });

    const lucro = faturamento - custos;

    const margem = faturamento > 0
        ? ((lucro / faturamento) * 100).toFixed(1)
        : 0;

    return `
📊 RELATÓRIO FINANCEIRO

💰 Faturamento: R$ ${faturamento.toFixed(2)}
📉 Custos: R$ ${custos.toFixed(2)}
✅ Lucro: R$ ${lucro.toFixed(2)}
📈 Margem: ${margem}%

🥦 Ingredientes cadastrados: ${ingredientes.length}
`.trim();

}

// =============================
// INTELIGÊNCIA ARTIFICIAL
// =============================

async function processarComando(mensagem) {

    const prompt = `
Você é um assistente de gestão para um delivery de marmitas.

Mensagem do usuário:
"${mensagem}"

Regras:

1 - Se for alteração de custo
ACAO:ATUALIZAR_CUSTO|ITEM:arroz|VALOR:5

2 - Se for registro de venda
ACAO:REGISTRAR_VENDA|PRODUTO:marmita|VALOR:30|CUSTO:18

3 - Se pedir relatório
ACAO:RELATORIO

4 - Se não entender
ACAO:NAO_ENTENDI

Responda apenas com o código.
`;

    try {

        const result = await model.generateContent(prompt);
        const resposta = result.response.text().trim();

        console.log("IA decidiu:", resposta);

        return resposta;

    } catch (error) {

        console.log("Erro IA:", error);

        return "ACAO:NAO_ENTENDI";

    }

}

// =============================
// WHATSAPP BOT
// =============================

WPPConnect.create({
    session: "bot-marmitas",

    tokenStore: "file",

    catchQR: (base64Qr) => {

        console.log("📲 QR gerado");

        qrCodeBase64 = base64Qr;

    },

    headless: true,

    puppeteerOptions: {
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox"
        ]
    }

})
.then((client) => start(client))
.catch((error) => console.log(error));

function start(client) {

    console.log("🤖 Bot iniciado!");

    client.onMessage(async (message) => {

        if (message.isGroupMsg) return;
        if (message.type !== 'chat') return;

        const decisao = await processarComando(message.body);

        if (decisao.includes("ACAO:ATUALIZAR_CUSTO")) {

            const partes = decisao.split("|");

            const item = partes[1].replace("ITEM:", "").trim();
            const valor = parseFloat(partes[2].replace("VALOR:", "").trim());

            const resp = await atualizarCusto(item, valor);

            client.sendText(message.from, resp);

        }

        else if (decisao.includes("ACAO:REGISTRAR_VENDA")) {

            const partes = decisao.split("|");

            const produto = partes[1].replace("PRODUTO:", "").trim();
            const valor = parseFloat(partes[2].replace("VALOR:", "").trim());
            const custo = parseFloat(partes[3].replace("CUSTO:", "").trim());

            const resp = await registrarVenda(produto, valor, custo);

            client.sendText(message.from, resp);

        }

        else if (decisao.includes("ACAO:RELATORIO")) {

            const rel = await gerarRelatorio();

            client.sendText(message.from, rel);

        }

        else {

            client.sendText(message.from, "Não entendi. Pode repetir?");

        }

    });

}
