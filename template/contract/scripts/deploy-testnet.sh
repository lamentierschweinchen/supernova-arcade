#!/usr/bin/env bash
#
# Deploy the Arcade game contract to MultiversX TESTNET — the public network on
# which Supernova is scheduled to activate (600ms rounds), so a real submission
# finalizes on the Supernova clock. Testnet EGLD is free (faucet), so this costs
# nothing.
#
# DEPLOY IN SHARD 0. Relayed v3 needs the transaction SENDER (the player's
# ephemeral key) in the same shard as the relayer, and the web client grinds keys
# into the relayer's shard. Deploy this contract from a SHARD-0 wallet so every
# call is intra-shard and finalizes fast. A funded shard-0 wallet whose address
# starts with the right bytes lands the contract in shard 0; if your deploy lands
# elsewhere, redeploy from a shard-0 wallet (or accept the cross-shard latency).
#
# Prerequisites:
#   1. Built artifacts exist:  (from contract/)  sc-meta all build
#   2. A funded testnet wallet PEM. Generate + fund:
#        mxpy wallet new --format pem --outfile .wallets/deployer.pem
#        # then fund the printed address at the testnet faucet in the Web Wallet:
#        #   https://testnet-wallet.multiversx.com  ->  Faucet
#
# Usage (from contract/):
#   GAME_ID="nova-taps" PEM=.wallets/deployer.pem ./scripts/deploy-testnet.sh
#
# Args passed to init: <game_id> <session_window_ms>. Window 0 => 30s default.
#
# On success it prints the contract bech32 address + deploy tx hash and writes
# scripts/deploy-info.testnet.json. Put the printed address in
# web/arcade.config.js (CONTRACT) and relayer/config.js (receivers).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="$(cd "$HERE/.." && pwd)"

PEM="${PEM:-$CONTRACT_DIR/.wallets/deployer.pem}"
PROXY="${PROXY:-https://testnet-gateway.multiversx.com}"
CHAIN="${CHAIN:-T}"
GAS_LIMIT="${GAS_LIMIT:-60000000}"
GAME_ID="${GAME_ID:-nova-taps}"
SESSION_WINDOW_MS="${SESSION_WINDOW_MS:-0}" # 0 => contract default (30s)
WASM="$CONTRACT_DIR/output/arcade-game.wasm"
ABI="$CONTRACT_DIR/output/arcade-game.abi.json"
OUT="$HERE/deploy-info.testnet.json"

echo "==> Deploying arcade-game to testnet"
echo "    game_id: $GAME_ID   session_window_ms: $SESSION_WINDOW_MS"
echo "    wasm:    $WASM"
echo "    pem:     $PEM"
echo "    proxy:   $PROXY   chain: $CHAIN"

if [ ! -f "$WASM" ]; then
  echo "ERROR: $WASM not found. Run 'sc-meta all build' from $CONTRACT_DIR first." >&2
  exit 1
fi
if [ ! -f "$PEM" ]; then
  echo "ERROR: wallet PEM not found at $PEM." >&2
  echo "Generate one: mxpy wallet new --format pem --outfile $PEM" >&2
  echo "Then fund the address at the testnet faucet." >&2
  exit 1
fi

# init args: game_id (string) + session_window_ms (u64). Nonce auto-fetched.
mxpy contract deploy \
  --bytecode "$WASM" \
  --abi "$ABI" \
  --pem "$PEM" \
  --proxy "$PROXY" \
  --chain "$CHAIN" \
  --gas-limit "$GAS_LIMIT" \
  --arguments "str:$GAME_ID" "$SESSION_WINDOW_MS" \
  --send \
  --wait-result \
  --outfile "$OUT"

echo ""
echo "==> Deploy submitted. Output written to $OUT"
python3 - "$OUT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
addr = d.get("contractAddress")
tx = d.get("emittedTransactionHash") or d.get("transactionHash")
print("    Contract address:", addr)
print("    Deploy tx:       ", tx)
if addr:
    print("    Explorer:  https://testnet-explorer.multiversx.com/accounts/" + addr)
    print("")
    print("    Next: put this address in web/arcade.config.js (CONTRACT) and")
    print("          relayer/config.js (receivers), then redeploy your site.")
PY
