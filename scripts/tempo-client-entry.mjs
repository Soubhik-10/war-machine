import { Provider, tempoWallet } from "accounts";
import { stringToHex } from "viem";
import { tempo } from "viem/tempo/chains";

let address = null;
let discovery = null;
let walletProvider = null;

const chainId = () => discovery?.payments?.chainId ?? 4217;
const chainHex = () => `0x${chainId().toString(16)}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function wallet() {
  // Tempo's postMessage connector opens wallet.tempo.xyz. It deliberately does
  // not inspect or try to switch any injected browser wallet such as MetaMask.
  walletProvider ??= Provider.create({
    adapter: tempoWallet({
      theme: { accent: "#f6be5a", radius: "14px", scheme: "dark" },
    }),
    chains: [tempo],
  });
  return walletProvider;
}

async function json(url, body) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Error(result.error || `Authentication failed (${response.status}).`);
  return result;
}

async function requestTempoAccount() {
  const accounts = await wallet().request({ method: "eth_requestAccounts" });
  const selected = accounts?.[0];
  if (typeof selected !== "string")
    throw Error(
      "Tempo Wallet did not return an account. Connect or create one, then try again.",
    );
  return selected;
}

export async function configure(info) {
  discovery = info;
  return info;
}

export async function signInWallet() {
  const selected = await requestTempoAccount();
  const { message } = await json("/api/auth/challenge", { chainId: chainId() });
  const signature = await wallet().request({
    method: "personal_sign",
    // Tempo Wallet follows EIP-1193's hex-data form for personal_sign.
    // The backend receives and verifies the original UTF-8 challenge text.
    params: [stringToHex(message), selected],
  });
  await json("/api/auth/verify", { address: selected, message, signature });
  address = selected;
  return address;
}

async function directWallet() {
  if (!discovery?.payments?.directEscrow)
    throw Error("Direct bounty escrow discovery has not been loaded.");
  const selected = await requestTempoAccount();
  if (address && selected.toLowerCase() !== address.toLowerCase())
    throw Error(
      "Reconnect with the Tempo Wallet account you used to sign in before funding or entering a bounty.",
    );
  address = selected;
  return selected;
}

async function sendDirect(selected, call) {
  if (!call || typeof call.to !== "string" || typeof call.data !== "string")
    throw Error("The escrow transaction plan is malformed.");
  const hash = await wallet().request({
    method: "eth_sendTransaction",
    params: [
      {
        from: selected,
        to: call.to,
        data: call.data,
        chainId: chainHex(),
      },
    ],
  });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw Error("Tempo Wallet did not return a transaction hash.");
  for (let attempt = 0; attempt < 90; attempt++) {
    const receipt = await wallet().request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    if (receipt) {
      if (receipt.status !== "0x1")
        throw Error(
          "The escrow transaction reverted. No bounty change was made.",
        );
      return hash;
    }
    await wait(1000);
  }
  throw Error(
    "The transaction is still confirming. Use Recover request; do not submit it again.",
  );
}

export async function executeEscrowPlan(plan) {
  const selected = await directWallet();
  const expected = discovery.payments.escrow?.toLowerCase();
  if (
    !plan ||
    plan.chainId !== chainId() ||
    plan.escrow?.toLowerCase() !== expected ||
    plan.call?.to?.toLowerCase() !== expected
  )
    throw Error("The bounty plan does not match the verified Tempo escrow.");
  if (plan.approval) {
    if (
      plan.approval.to?.toLowerCase() !==
      discovery.payments.token?.toLowerCase()
    )
      throw Error("The approval token does not match pathUSD.");
    await sendDirect(selected, plan.approval);
  }
  return sendDirect(selected, plan.call);
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  address = null;
}
