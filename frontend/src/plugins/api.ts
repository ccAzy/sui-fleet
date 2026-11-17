import axios from 'axios'

axios.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest'

// baseURL 必须是绝对根路径 `/`，不能是相对当前页的 `./`。
//
// `./` 会让请求跟着页面路径走：在 `/dev/ui` 下，`get('api/load')` 会被浏览器
// 解析成 `/dev/api/load`，既命中不了后端路由、也不在 vite proxy 的 /api 规则里，
// 最终落回 index.html；前端把 HTML 当 JSON 读，报 `unknown data: <!DOCTYPE html>`。
// 现有 16 条路由恰好都是单层路径才没暴露，以后加 `/rules/edit`、`/clients/:id`
// 这类页面会整页数据全挂。
//
// 这个面板固定部署在域名根路径（index.html 里资源引用也都是 `/assets/...`），
// 所以改成 `/` 是安全的。
axios.defaults.baseURL = '/'
const pendingRequests = new Map()

axios.interceptors.request.use(
    (config) => {
        // Generate a unique key for the request
        const requestKey = `${config.method}:${config.url}`
        
        // Check if there is already a pending request with the same key
        if (pendingRequests.has(requestKey)) {
            const cancelSource = pendingRequests.get(requestKey)
            cancelSource.cancel('Duplicate request cancelled')
        }
        
        // Create a new cancel token for the request
        const cancelSource = axios.CancelToken.source()
        config.cancelToken = cancelSource.token
        
        // Store the cancel token in the pending requests map
        pendingRequests.set(requestKey, cancelSource)
        
        if (config.data instanceof FormData) {
            config.headers['Content-Type'] = 'multipart/form-data'
        }
        return config
    },
    (error) => Promise.reject(error),
)

axios.interceptors.response.use(
    (response) => {
        // Remove the request from the pending requests map
        const requestKey = `${response.config.method}:${response.config.url}`
        pendingRequests.delete(requestKey)
        return response
    },
    (error) => {
        if (axios.isCancel(error)) {
            // Handle duplicate request cancellation here if needed
            console.warn(error.message)
        } else {
            // Remove the request from the pending requests map on error
            const requestKey = `${error.config.method}:${error.config.url}`
            pendingRequests.delete(requestKey)
        }
        return Promise.reject(error)
    }
)

const api = axios.create()

export default api
