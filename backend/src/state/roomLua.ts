// Return codes:
//  1 = OK (setup stored + locked)
//  0 = SETUP_ALREADY_LOCKED

export const LUA_SET_SETUP_IF_UNLOCKED = `
  local stateKey = KEYS[1]
  local lockKey = KEYS[2]

  local stateJson = ARGV[1]
  local ttl = tonumber(ARGV[2])

  if redis.call("EXISTS", lockKey) == 1 then
    return 0
  end

  -- Lock first to ensure single-setup invariant, then store the state.
  redis.call("SET", lockKey, "1", "EX", ttl)
  redis.call("SET", stateKey, stateJson, "EX", ttl)
  return 1
`;
