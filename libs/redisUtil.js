import { createClient } from 'redis';

/*
 * node-redis v4+ requires an explicit connect() call and at least one
 * 'error' listener (a client without one crashes the process on the first
 * network error). Commands issued before the connection is ready are held
 * in the client's offline queue, which preserves the fire-and-forget
 * construction style the portal modules use.
 */
export function createRedisClient(redisConfig, onError) {
    const options = {
        socket: {
            host: redisConfig.host,
            port: redisConfig.port
        }
    };
    if (redisConfig.password) options.password = redisConfig.password;
    const client = createClient(options);
    client.on('error', onError || function () {});
    // connect() failures also arrive on the 'error' event
    client.connect().catch(function () {});
    return client;
}

/*
 * Run an array of raw [command, arg, ...] tuples in a single MULTI/EXEC,
 * the calling convention the portal used with node-redis v3. Replies are
 * raw RESP values: commands like HGETALL yield a flat [field, value, ...]
 * array here, not an object (see flatRepliesToObject).
 */
export function execCommands(client, commands) {
    const multi = client.multi();
    for (const args of commands) {
        multi.addCommand(args.map(String));
    }
    return multi.exec();
}

/* Convert a raw flat HGETALL reply ([field, value, ...]) into an object. */
export function flatRepliesToObject(reply) {
    const obj = {};
    for (let i = 0; i < reply.length; i += 2) {
        obj[reply[i]] = reply[i + 1];
    }
    return obj;
}
