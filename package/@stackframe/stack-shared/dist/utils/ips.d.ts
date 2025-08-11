type Ipv4Address = `${number}.${number}.${number}.${number}`;
type Ipv6Address = string;
declare function isIpAddress(ip: string): ip is Ipv4Address | Ipv6Address;
declare function assertIpAddress(ip: string): asserts ip is Ipv4Address | Ipv6Address;

export { type Ipv4Address, type Ipv6Address, assertIpAddress, isIpAddress };
