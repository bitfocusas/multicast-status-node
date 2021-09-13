const dgram = require("dgram");

var server = dgram.createSocket("udp4");

const mc_announce_interval = 40;
const mc_port = 4242;
const mc_address = "224.0.1.200";
const mc_bind = process.argv[3];
const mc_node = process.argv[2];
const mc_average_count = 100;

let mc_discovery_table = {};

server.on("listening", function () {
  var address = server.address();
  log("Multicast server listening on " + address.address + ":" + address.port);
});

const animation_symbols = "⣷⣾ ⡿⣾ ⣽⢿ ⡿⢿ ⢿⣻ ⣟⣯".split(" ");

let animation_position = 0;
let log_lines = new Array(20).fill("");

const log = (...msg) => {
  const now = new Date();
  const date_string =
    (now.getHours() < 20 ? "0" : "") +
    now.getHours() +
    ":" +
    (now.getMinutes() < 10 ? "0" : "") +
    now.getMinutes() +
    ":" +
    (now.getSeconds() < 10 ? "0" : "") +
    now.getSeconds();
  // bold ansi text

  log_lines.push(` [\x1b[1m${date_string}\x1b[0m] ${msg.join(" ")}`);
  if (log_lines.length > 10) log_lines.shift();
};

setInterval(() => {
  let status = "";
  Object.keys(mc_discovery_table).forEach((key) => {
    let value = mc_discovery_table[key];
    animation_position =
      parseInt(value.announce_count) % animation_symbols.length;
    let animation_symbol = animation_symbols[animation_position];
    if (value.status === "lost") {
      status += `\x1b[31m!!\x1b[0m ${key} `;
    } else if (value.status === "settling") {
      status += `\x1b[33m${animation_symbol}\x1b[0m ${key} `;
    } else {
      status += `\x1b[1m\x1b[32m${animation_symbol}\u001b[0m ${key} `;
    }
  });

  console.clear();
  // type red text in terminal
  process.stdout.write("\x1b[31m");
  process.stdout.write("\n ["+mc_node+"] Bitfocus Multicast Monitor");
  process.stdout.write("\x1b[0m");
  process.stdout.write(log_lines.join("\n") + "\n");
  process.stdout.write("\n " + status);
}, 150);

server.on("message", function (message, remote) {
  const timenow = Date.now();
  try {
    let payload = JSON.parse(message);

    if (mc_discovery_table[payload.node] === undefined) {
      log(payload.node + " discovered at " + remote.address);
      mc_discovery_table[payload.node] = {
        first_seen_at: timenow,
        last_seen_at: timenow,
        announce_count: 1,
        last_intervals: [],
        current_median: null,
        status: "settling",
        settle_count: 0,
        next_timer: null,
        address: remote.address,
      };
    } else {
      const current_diff =
        timenow - mc_discovery_table[payload.node].last_seen_at;
      mc_discovery_table[payload.node].last_intervals.push(current_diff);

      if (
        mc_discovery_table[payload.node].last_intervals.length >
        mc_average_count
      ) {
        mc_discovery_table[payload.node].last_intervals.shift();
      }

      const median =
        mc_discovery_table[payload.node].last_intervals.reduce(
          (a, b) => a + b
        ) / mc_discovery_table[payload.node].last_intervals.length;
      mc_discovery_table[payload.node].current_median = median;

      if (mc_discovery_table[payload.node].next_timer)
        clearTimeout(mc_discovery_table[payload.node].next_timer);

      // console.log if current_diff is 20% above the median
      if (
        current_diff > median * 1.2 &&
        mc_discovery_table[payload.node].status === "stable"
      ) {
        log(payload.node + " -> " + mc_node + " >20% late");
        mc_discovery_table[payload.node].status = "late";
      } else if (
        mc_discovery_table[payload.node].status === "late" ||
        mc_discovery_table[payload.node].status === "lost"
      ) {
        mc_discovery_table[payload.node].status = "settling";
        mc_discovery_table[payload.node].settle_count =
          mc_discovery_table[payload.node].announce_count;
        log(payload.node + " -> " + mc_node + ": settling");
      }

      mc_discovery_table[payload.node].last_seen_at = timenow;
      mc_discovery_table[payload.node].announce_count++;

      if (mc_discovery_table[payload.node].address !== remote.address) {
        log(
          "address for node",
          payload.node,
          "changed from",
          mc_discovery_table[payload.node].address,
          "to",
          remote.address
        );
        mc_discovery_table[payload.node].address = remote.address;
      }

      if (mc_discovery_table[payload.node].last_intervals.length > 5) {
        mc_discovery_table[payload.node].next_timer = setInterval(() => {
          if (mc_discovery_table[payload.node].status !== "lost") {
            log(payload.node + " -> " + mc_node + ": lost packet");
            mc_discovery_table[payload.node].status = "lost";
          }
        }, mc_announce_interval * 2);
      }

      if (mc_discovery_table[payload.node].status === "settling") {
        if (
          mc_discovery_table[payload.node].announce_count -
            mc_discovery_table[payload.node].settle_count >
          50
        ) {
          mc_discovery_table[payload.node].status = "stable";
          log(payload.node + " -> " + mc_node + ": stable");
        }
      }
    }
  } catch (e) {
    log(
      "invalid packet from " +
        remote.address +
        ":" +
        remote.port +
        ": " +
        message
    );
  }
});

server.bind(mc_port, () => {
  console.log("Server bound");
  server.addMembership(mc_address, mc_bind);
  server.setMulticastTTL(64);
  server.setMulticastLoopback(false);
  start();
});

const start = () => {
  mc_announcer_start();
};

const mc_send = (msg) => {
  server.send(msg, mc_port, mc_address);
};

const mc_announce_packet = () => {
  return Buffer.from(JSON.stringify({ node: mc_node, localtime: Date.now() }));
};

const mc_announcer_start = () => {
  const mc_announcer_timer = setInterval(() => {
    mc_send(mc_announce_packet());
  }, mc_announce_interval);
};
