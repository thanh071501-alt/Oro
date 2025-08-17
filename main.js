const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { SigningCosmWasmClient, CosmWasmClient } = require('@cosmjs/cosmwasm-stargate');
const { DirectSecp256k1HdWallet } = require('@cosmjs/proto-signing');
const { calculateFee, GasPrice } = require('@cosmjs/stargate');
const http = require('http');

const PORT = process.env.PORT || 3000;
// Lấy URL của app từ Render dashboard
const APP_URL = 'https://oro-32z7.onrender.com';

// Ping mỗi 10 phút để không sleep
setInterval(async () => {
    try {
        const response = await fetch(APP_URL);
        console.log(`🏓 Keep-alive: ${new Date().toLocaleString()}`);
    } catch (error) {
        console.log('❌ Ping failed:', error.message);
    }
}, 10 * 60 * 1000); // 10 phút
// Tạo HTTP server đơn giản
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OROSWAP BOT is running!');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
console.clear();
console.log("\x1b[35m%s\x1b[0m", "============================================");
console.log("\x1b[36m%s\x1b[0m", "      OROSWAP BOT - VÍ KEPLR/LEAP       ");
console.log("\x1b[36m%s\x1b[0m", "               VELHUST                   ");
console.log("\x1b[35m%s\x1b[0m", "============================================\n");

const MNEMONIC = `
wealth option session shy tube chef traffic seed grow word crack almost
`.trim();

const CONFIG = {
    rpcEndpoint: "https://public-zigchain-testnet-rpc.numia.xyz",
    chainId: "zig-test-2",
    zigDenom: "uzig",
    oroDenom: "coin.zig10rfjm85jmzfhravjwpq3hcdz8ngxg7lxd0drkr.uoro",
    swapContract: "zig15jqg0hmp9n06q0as7uk3x9xkwr9k3r7yh4ww2uc0hek8zlryrgmsamk4qg",
    gasPrice: GasPrice.fromString("0.025uzig"),
};
function randomAmount() {
    const min = 0.00001;
    const max = 0.00009;
    const value = Math.random() * (max - min) + min;
    return parseFloat(value.toFixed(5));
}

const ZIG_AMOUNT = randomAmount();
const ORO_AMOUNT = randomAmount();
function randomLiqValueAsString() {
  const min = 0.00001;
  const max = 0.00009;
  const random = Math.random() * (max - min) + min;
  return random.toFixed(5); // Chuỗi có 4 chữ số thập phân
}

const LIQ_ORO = randomLiqValueAsString();
const LIQ_ZIG = randomLiqValueAsString();

const delay = async (ms) => {
    process.stdout.write(`\r⏳ Đang chờ ${ms / 1000} giây... `);
    await new Promise(res => setTimeout(res, ms));
    console.log("✅ Hoàn thành chờ");
};

async function getBalance(mnemonic, denom) {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: "zig" });
    const [account] = await wallet.getAccounts();
    const client = await CosmWasmClient.connect(CONFIG.rpcEndpoint);
    const balance = await client.getBalance(account.address, denom);
    return { address: account.address, amount: balance.amount, formatted: Number(balance.amount) / 1e6 };
}

async function getBeliefPrice(denom, amount) {
    const client = await CosmWasmClient.connect(CONFIG.rpcEndpoint);
    const sim = await client.queryContractSmart(CONFIG.swapContract, {
        simulation: {
            offer_asset: {
                amount,
                info: { native_token: { denom: denom } }
            }
        }
    });
    const beliefPrice = (BigInt(amount) * BigInt(1e6)) / BigInt(sim.return_amount);
    return (Number(beliefPrice) / 1e6).toFixed(18);
}

async function swap(mnemonic, amount, fromDenom, toDenom) {
    try {
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: "zig" });
        const [account] = await wallet.getAccounts();
        const client = await SigningCosmWasmClient.connectWithSigner(CONFIG.rpcEndpoint, wallet, {
            gasPrice: CONFIG.gasPrice, chainId: CONFIG.chainId
        });

        const baseAmount = Math.floor(amount * 1e6).toString();
        const beliefPrice = await getBeliefPrice(fromDenom, baseAmount);
        const fee = calculateFee(320000, CONFIG.gasPrice);

        const msg = {
            swap: {
                belief_price: beliefPrice,
                max_spread: "0.005",
                offer_asset: {
                    amount: baseAmount,
                    info: { native_token: { denom: fromDenom } }
                }
            }
        };

        const result = await client.execute(account.address, CONFIG.swapContract, msg, fee, "Swap", [
            { denom: fromDenom, amount: baseAmount }
        ]);

        const fromName = fromDenom === CONFIG.zigDenom ? "ZIG" : "ORO";
        const toName = toDenom === CONFIG.zigDenom ? "ZIG" : "ORO";
        console.log(`\n✅ Swap ${fromName} → ${toName} thành công! TX: ${result.transactionHash}`);
        console.log(`🔍 https://zigscan.org/tx/${result.transactionHash}`);
    } catch (e) {
        console.error(`❌ Swap thất bại:`, e.message);
    }
}

// Lấy tỷ lệ pool hiện tại (ZIG/ORO)
async function getPoolRatio() {
    const client = await CosmWasmClient.connect(CONFIG.rpcEndpoint);
    const pool = await client.queryContractSmart(CONFIG.swapContract, { pool: {} });

    const oroAsset = pool.assets.find(a => a.info.native_token?.denom === CONFIG.oroDenom);
    const zigAsset = pool.assets.find(a => a.info.native_token?.denom === CONFIG.zigDenom);

    const oroAmount = Number(oroAsset.amount);
    const zigAmount = Number(zigAsset.amount);

    const ratio = zigAmount / oroAmount; // số ZIG cho 1 ORO
    return { oroAmount, zigAmount, ratio };
}

async function addLiquidity(mnemonic, amountUoro, _amountUzig) {
    try {
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: "zig" });
        const [account] = await wallet.getAccounts();
        const client = await SigningCosmWasmClient.connectWithSigner(CONFIG.rpcEndpoint, wallet, {
            gasPrice: CONFIG.gasPrice, chainId: CONFIG.chainId
        });

        // Query pool để tính đúng tỷ lệ
        const { ratio } = await getPoolRatio();

        // Convert ORO thành base unit
        const uoroBaseAmount = Math.floor(Number(amountUoro) * 1e6);

        // Tính lượng ZIG tương ứng theo tỷ lệ pool
        const uzigBaseAmount = Math.floor(uoroBaseAmount * ratio);

        // Nếu ra 0 thì bỏ qua
        if (uoroBaseAmount <= 0 || uzigBaseAmount <= 0) {
            console.log("⚠️ Bỏ qua vì số lượng quá nhỏ.");
            return;
        }

        const msg = {
            provide_liquidity: {
                assets: [
                    {
                        amount: uoroBaseAmount.toString(),
                        info: { native_token: { denom: CONFIG.oroDenom } }
                    },
                    {
                        amount: uzigBaseAmount.toString(),
                        info: { native_token: { denom: CONFIG.zigDenom } }
                    }
                ],
                slippage_tolerance: "0.05" // 1% thôi là đủ
            }
        };

        const funds = [
            { denom: CONFIG.oroDenom, amount: uoroBaseAmount.toString() },
            { denom: CONFIG.zigDenom, amount: uzigBaseAmount.toString() }
        ];

        const fee = calculateFee(320000, CONFIG.gasPrice);

        const result = await client.execute(account.address, CONFIG.swapContract, msg, fee, "Provide Liquidity", funds);

        console.log(`\n✅ Cung cấp thanh khoản cặp ORO/ZIG thành công! TX: ${result.transactionHash}`);
        console.log(`🔍 https://zigscan.org/tx/${result.transactionHash}`);
    } catch (err) {
        console.error("❌ Thêm thanh khoản thất bại:", err.message);
    }
}

async function runBot() {
    for (let liqCount = 0; liqCount < 1000000000; liqCount++) {
        console.log(`\n=== Chu kỳ Swap thứ ${liqCount + 1} ===`);
        for (let i = 0; i < 5; i++) {
            await swap(MNEMONIC, ZIG_AMOUNT, CONFIG.zigDenom, CONFIG.oroDenom);
            await delay(5000);
        }

        for (let i = 0; i < 5; i++) {
            await swap(MNEMONIC, ORO_AMOUNT, CONFIG.oroDenom, CONFIG.zigDenom);
            await delay(5000);
        }

         for (let i = 0; i < 1000; i++) {
           console.log("\n💧 Đang thêm thanh khoản...");
           await addLiquidity(MNEMONIC, LIQ_ORO, LIQ_ZIG);
            await delay(5000);
        }

        
    }
}

runBot();
