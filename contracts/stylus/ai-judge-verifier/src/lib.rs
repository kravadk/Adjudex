// Stylus port of AIJudgeVerifier.sol — V2 with optimistic dispute window.
//
// ABI-identical to the Solidity V2 surface so the off-chain judge service
// (which signs keccak256(abi.encode(chainId, pool, marketId, outcome,
// evidenceHash)) with the Ethereum signed-message prefix) keeps the same
// key + payload. Stylus contracts cannot use Solidity's `ecrecover`
// precompile; we recover in pure Rust via `k256`. The math is identical.
//
// Flow:
//   1. propose() stores the signed verdict as Pending (no pool.resolve()).
//   2. challenge() inside CHALLENGE_WINDOW (2h) flips it to Disputed.
//   3. finalize() after the window resolves the pool.
//   4. override_and_finalize() lets the owner settle disputed proposals.
//
// V1 verify_and_resolve() is retained but gated to a `fastTrackUntil`
// timestamp (default 0 = disabled).

#![cfg_attr(not(feature = "export-abi"), no_main)]
extern crate alloc;

use alloc::vec::Vec;
use alloy_primitives::{Address, B256, U256};
use alloy_sol_types::SolValue;
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use sha3::{Digest, Keccak256};
use stylus_sdk::prelude::*;

sol_interface! {
    interface IParimutuelPool {
        function resolve(uint8 side) external;
        function resolver() external view returns (address);
    }
}

// Proposal lifecycle status (matches Solidity enum ordering).
const STATUS_NONE: u8 = 0;
const STATUS_PENDING: u8 = 1;
const STATUS_DISPUTED: u8 = 2;
const STATUS_FINALIZED: u8 = 3;

// Challenge window: 2 hours in seconds — must match Solidity constant.
const CHALLENGE_WINDOW_SECS: u64 = 2 * 60 * 60;

sol_storage! {
    #[entrypoint]
    pub struct AIJudgeVerifier {
        address judge;
        address owner;
        uint256 fast_track_until;
        mapping(uint256 => Proposal) proposals;
    }

    pub struct Proposal {
        address pool;
        uint8 outcome;
        bytes32 evidence_hash;
        uint64 proposed_at;
        uint8 status;
        address challenger;
    }
}

#[public]
impl AIJudgeVerifier {
    /// One-shot init — Stylus has no EVM-style constructor.
    pub fn initialize(&mut self, judge_addr: Address) -> Result<(), Vec<u8>> {
        if self.judge.get() != Address::ZERO {
            return Err(b"already initialized".to_vec());
        }
        if judge_addr == Address::ZERO {
            return Err(b"judge=0".to_vec());
        }
        self.judge.set(judge_addr);
        self.owner.set(stylus_sdk::msg::sender());
        self.fast_track_until.set(U256::ZERO);
        Ok(())
    }

    // ─── Views ────────────────────────────────────────────────────────

    pub fn judge(&self) -> Address {
        self.judge.get()
    }

    pub fn owner(&self) -> Address {
        self.owner.get()
    }

    pub fn fast_track_until(&self) -> U256 {
        self.fast_track_until.get()
    }

    pub const CHALLENGE_WINDOW: u64 = CHALLENGE_WINDOW_SECS;

    pub fn proposal_status(&self, market_id: U256) -> u8 {
        self.proposals.get(market_id).status.get()
    }

    pub fn challenge_deadline(&self, market_id: U256) -> U256 {
        let p = self.proposals.get(market_id);
        if p.status.get() != STATUS_PENDING {
            return U256::ZERO;
        }
        let proposed_at: u64 = p.proposed_at.get().to::<u64>();
        U256::from(proposed_at as u128 + CHALLENGE_WINDOW_SECS as u128)
    }

    pub fn can_finalize(&self, market_id: U256) -> bool {
        let p = self.proposals.get(market_id);
        if p.status.get() != STATUS_PENDING {
            return false;
        }
        let proposed_at: u64 = p.proposed_at.get().to::<u64>();
        stylus_sdk::block::timestamp() >= proposed_at + CHALLENGE_WINDOW_SECS
    }

    // ─── Configuration (owner-only) ───────────────────────────────────

    pub fn transfer_ownership(&mut self, new_owner: Address) -> Result<(), Vec<u8>> {
        self.only_owner()?;
        if new_owner == Address::ZERO {
            return Err(b"owner=0".to_vec());
        }
        self.owner.set(new_owner);
        Ok(())
    }

    pub fn set_fast_track_until(&mut self, ts: U256) -> Result<(), Vec<u8>> {
        self.only_owner()?;
        self.fast_track_until.set(ts);
        Ok(())
    }

    // ─── Digest / signature verification ──────────────────────────────

    pub fn digest(
        &self,
        pool: Address,
        market_id: U256,
        outcome: u8,
        evidence_hash: B256,
    ) -> B256 {
        let chain_id = U256::from(stylus_sdk::block::chainid());
        let raw = (chain_id, pool, market_id, outcome, evidence_hash).abi_encode();
        let inner = Keccak256::digest(&raw);

        let mut h = Keccak256::new();
        h.update(b"\x19Ethereum Signed Message:\n32");
        h.update(inner);
        B256::from_slice(h.finalize().as_slice())
    }

    pub fn verify(
        &self,
        pool: Address,
        market_id: U256,
        outcome: u8,
        evidence_hash: B256,
        signature: Vec<u8>,
    ) -> Result<bool, Vec<u8>> {
        if signature.len() != 65 {
            return Err(b"sig length".to_vec());
        }
        let d = self.digest(pool, market_id, outcome, evidence_hash);
        let recovered = match recover(d.as_slice(), &signature) {
            Some(a) => a,
            None => return Ok(false),
        };
        Ok(recovered == self.judge.get())
    }

    // ─── V2: optimistic resolution ────────────────────────────────────

    pub fn propose(
        &mut self,
        pool: Address,
        market_id: U256,
        outcome: u8,
        evidence_hash: B256,
        signature: Vec<u8>,
    ) -> Result<(), Vec<u8>> {
        if outcome > 1 {
            return Err(b"bad outcome".to_vec());
        }
        if !self.verify(pool, market_id, outcome, evidence_hash, signature)? {
            return Err(b"bad sig".to_vec());
        }
        let mut p = self.proposals.setter(market_id);
        if p.status.get() != STATUS_NONE {
            return Err(b"exists".to_vec());
        }
        p.pool.set(pool);
        p.outcome.set(outcome);
        p.evidence_hash.set(evidence_hash);
        p.proposed_at
            .set(U256::from(stylus_sdk::block::timestamp()).try_into().unwrap_or(0));
        p.status.set(STATUS_PENDING);
        Ok(())
    }

    pub fn challenge(&mut self, market_id: U256) -> Result<(), Vec<u8>> {
        let mut p = self.proposals.setter(market_id);
        if p.status.get() != STATUS_PENDING {
            return Err(b"not pending".to_vec());
        }
        let proposed_at: u64 = p.proposed_at.get().to::<u64>();
        if stylus_sdk::block::timestamp() >= proposed_at + CHALLENGE_WINDOW_SECS {
            return Err(b"window closed".to_vec());
        }
        p.status.set(STATUS_DISPUTED);
        p.challenger.set(stylus_sdk::msg::sender());
        Ok(())
    }

    pub fn finalize(&mut self, market_id: U256) -> Result<(), Vec<u8>> {
        let (pool_addr, outcome) = {
            let p = self.proposals.get(market_id);
            if p.status.get() != STATUS_PENDING {
                return Err(b"not pending".to_vec());
            }
            let proposed_at: u64 = p.proposed_at.get().to::<u64>();
            if stylus_sdk::block::timestamp() < proposed_at + CHALLENGE_WINDOW_SECS {
                return Err(b"challenge window open".to_vec());
            }
            (p.pool.get(), p.outcome.get())
        };
        self.resolve_pool(market_id, pool_addr, outcome)
    }

    pub fn override_and_finalize(
        &mut self,
        market_id: U256,
        outcome: u8,
    ) -> Result<(), Vec<u8>> {
        self.only_owner()?;
        if outcome > 1 {
            return Err(b"bad outcome".to_vec());
        }
        let pool_addr = {
            let p = self.proposals.get(market_id);
            if p.status.get() != STATUS_DISPUTED {
                return Err(b"not disputed".to_vec());
            }
            p.pool.get()
        };
        self.resolve_pool(market_id, pool_addr, outcome)
    }

    // ─── V1 backwards-compat (fast-track only, deprecated) ────────────

    pub fn verify_and_resolve(
        &mut self,
        pool: IParimutuelPool,
        market_id: U256,
        outcome: u8,
        evidence_hash: B256,
        signature: Vec<u8>,
    ) -> Result<(), Vec<u8>> {
        if U256::from(stylus_sdk::block::timestamp()) > self.fast_track_until.get() {
            return Err(b"fastTrack disabled - use propose+finalize".to_vec());
        }
        if outcome > 1 {
            return Err(b"bad outcome".to_vec());
        }
        let pool_addr: Address = pool.into();
        if !self.verify(pool_addr, market_id, outcome, evidence_hash, signature)? {
            return Err(b"bad sig".to_vec());
        }
        let mut p = self.proposals.setter(market_id);
        if p.status.get() != STATUS_NONE {
            return Err(b"exists".to_vec());
        }
        p.pool.set(pool_addr);
        p.outcome.set(outcome);
        p.evidence_hash.set(evidence_hash);
        p.proposed_at
            .set(U256::from(stylus_sdk::block::timestamp()).try_into().unwrap_or(0));
        p.status.set(STATUS_FINALIZED);

        let resolver = pool
            .resolver(self)
            .map_err(|_| b"resolver call failed".to_vec())?;
        if resolver != stylus_sdk::contract::address() {
            return Err(b"not resolver".to_vec());
        }
        pool.resolve(self, outcome)
            .map_err(|_| b"resolve failed".to_vec())?;
        Ok(())
    }
}

impl AIJudgeVerifier {
    fn only_owner(&self) -> Result<(), Vec<u8>> {
        if stylus_sdk::msg::sender() != self.owner.get() {
            return Err(b"not owner".to_vec());
        }
        Ok(())
    }

    fn resolve_pool(
        &mut self,
        market_id: U256,
        pool_addr: Address,
        outcome: u8,
    ) -> Result<(), Vec<u8>> {
        let pool = IParimutuelPool::new(pool_addr);
        let resolver = pool
            .resolver(self)
            .map_err(|_| b"resolver call failed".to_vec())?;
        if resolver != stylus_sdk::contract::address() {
            return Err(b"not resolver".to_vec());
        }
        pool.resolve(self, outcome)
            .map_err(|_| b"resolve failed".to_vec())?;
        let mut p = self.proposals.setter(market_id);
        p.status.set(STATUS_FINALIZED);
        Ok(())
    }
}

fn recover(digest: &[u8], sig: &[u8]) -> Option<Address> {
    if sig.len() != 65 {
        return None;
    }
    let v_raw = sig[64];
    let v_norm = if v_raw >= 27 { v_raw - 27 } else { v_raw };
    let rec_id = RecoveryId::try_from(v_norm).ok()?;
    let signature = Signature::from_slice(&sig[..64]).ok()?;
    let vk = VerifyingKey::recover_from_prehash(digest, &signature, rec_id).ok()?;
    let encoded = vk.to_encoded_point(false);
    let hash = Keccak256::digest(&encoded.as_bytes()[1..]);
    Some(Address::from_slice(&hash[12..]))
}
