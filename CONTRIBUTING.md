# 贡献说明

本仓库是 [coderoadmap.cn](https://coderoadmap.cn) 的内容索引，**不接受内容投稿**。

## 可以提 Issue 的情况

- 课程或路线图的标题、链接、分类有误
- 某条记录指向 404
- 同步脚本生成了错误内容

提交时请附上主站对应页面的 URL，便于定位。

## 不要做的事

- 不要直接编辑 `README.md`、`docs/**`、`data/**`——这些文件由 `scripts/sync.mjs` 每日生成，手动修改会在下次同步时被覆盖
- 不要提交 PR 修改索引内容

## 本地验证

```bash
node scripts/sync.mjs
git diff
```

脚本会先校验接口条数，校验不通过时直接退出且不写文件。
