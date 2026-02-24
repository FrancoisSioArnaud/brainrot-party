// Return codes:
//  0 = OK
//  1 = DEVICE_ALREADY_HAS_PLAYER
//  2 = PLAYER_ALREADY_TAKEN
//  3 = PLAYER_INACTIVE
//  4 = PLAYER_NOT_FOUND

export const LUA_CLAIM_PLAYER = `
  local deviceToPlayer = KEYS[1]
  local playerToDevice = KEYS[2]

  local deviceId = ARGV[1]
  local playerId = ARGV[2]
  local playerExists = ARGV[3]
  local playerActive = ARGV[4]

  if playerExists ~= "1" then
    return 4
  end

  if playerActive ~= "1" then
    return 3
  end

  local existingPlayer = redis.call("HGET", deviceToPlayer, deviceId)
  if existingPlayer then
    return 1
  end

  local existingDevice = redis.call("HGET", playerToDevice, playerId)
  if existingDevice then
    return 2
  end

  redis.call("HSET", deviceToPlayer, deviceId, playerId)
  redis.call("HSET", playerToDevice, playerId, deviceId)
  return 0
`;

export const LUA_RELEASE_BY_PLAYER = `
  local deviceToPlayer = KEYS[1]
  local playerToDevice = KEYS[2]

  local playerId = ARGV[1]

  local deviceId = redis.call("HGET", playerToDevice, playerId)
  if not deviceId then
    return 0
  end

  redis.call("HDEL", playerToDevice, playerId)
  redis.call("HDEL", deviceToPlayer, deviceId)
  return 0
`;

export const LUA_RELEASE_BY_DEVICE = `
  local deviceToPlayer = KEYS[1]
  local playerToDevice = KEYS[2]

  local deviceId = ARGV[1]

  local playerId = redis.call("HGET", deviceToPlayer, deviceId)
  if not playerId then
    return 0
  end

  redis.call("HDEL", deviceToPlayer, deviceId)
  redis.call("HDEL", playerToDevice, playerId)
  return 0
`;
