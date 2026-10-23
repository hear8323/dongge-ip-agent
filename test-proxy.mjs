/**
 * 测试 Kling AI 代理中间层
 * 
 * 用法: node test-proxy.mjs
 */

const http = require('node:http');

// 模拟 TransDhServer 请求
function testProxy() {
  console.log('🧪 测试数字人代理中间层...\n');
  
  // 1. 健康检查
  console.log('1. 测试 /health 端点...');
  const healthReq = http.get('http://127.0.0.1:8899/health', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('   ✓ 响应:', data);
      
      // 2. 提交任务（模拟）
      console.log('\n2. 测试 /submit 端点...');
      const submitData = JSON.stringify({
        audio_url: 'http://test.com/test.mp3',
        video_url: 'http://test.com/test.mp4',
        code: 'test-code-123'
      });
      
      const submitReq = http.request({
        hostname: '127.0.0.1',
        port: 8899,
        path: '/submit',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(submitData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('   ✓ 响应:', data);
          
          // 3. 查询状态
          console.log('\n3. 测试 /query 端点...');
          const queryReq = http.get('http://127.0.0.1:8899/query?code=test-code-123', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              console.log('   ✓ 响应:', data);
              console.log('\n✅ 代理中间层测试完成');
            });
          });
          
          queryReq.on('error', err => {
            console.log('   ✗ 查询失败:', err.message);
          });
        });
      });
      
      submitReq.on('error', err => {
        console.log('   ✗ 提交失败:', err.message);
      });
      
      submitReq.write(submitData);
      submitReq.end();
    });
  });
  
  healthReq.on('error', err => {
    console.log('   ✗ 健康检查失败:', err.message);
    console.log('\n💡 提示: 请先启动代理服务');
  });
}

testProxy();
