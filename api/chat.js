// api/chat.js
export default async function handler(req, res) {
  // 限制只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { messages, code } = req.body;

  // 🔴 👉 在这里设置你打算在小红书里发给粉丝的暗号（支持大小写模糊）
  const CORRECT_CODE = "DeepSeek六六六"; 

  // 验证暗号是否正确
  if (!code || code.trim().toLowerCase() !== CORRECT_CODE.toLowerCase()) {
    return res.status(200).json({ 
      isCodeError: true, 
      error: '暗号错误或已过期，请去小红书获取最新暗号！' 
    });
  }

  // 暗号验证通过，从环境变量中读取你的 DeepSeek API Key
  const apiKey = process.env.DEEPSEEK_API_KEY; 
  
  if (!apiKey) {
    return res.status(500).json({ error: '服务器未配置 DeepSeek API Key，请检查 Vercel 后台设置。' });
  }

  try {
    // 调用 DeepSeek 官方接口
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat', 
        messages: messages,
        temperature: 0.7,
        max_tokens: 2500 // 🚀 限制单次生成最大Token长度，防止面试长篇策略报告由于过长直接卡挂 Vercel 路由
      })
    });

    // 如果 DeepSeek 官方服务报错，给出友好提示
    if (!response.ok) {
      const errText = await response.text();
      console.error("DeepSeek API 报错响应:", errText);
      return res.status(response.status).json({ error: `DeepSeek 引擎响应异常，请稍后再试。` });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error("Vercel 后端异常:", error);
    return res.status(500).json({ error: 'DeepSeek 接口连接失败或请求超时: ' + error.message });
  }
}
