/** @type {import('next').NextConfig} */
const nextConfig = {
    images:{
        remotePatterns: [{
            hostname: 'pbs.twimg.com',
            protocol: 'https',
            
        }]
    }
};

export default nextConfig;
