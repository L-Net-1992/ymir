import {
  getDatasetGroups,
  getDatasetByGroup,
  queryDatasets,
  getDataset,
  batchDatasets,
  analysis,
  batchAct,
  delDataset,
  delDatasetGroup,
  createDataset,
  updateDataset,
  getInternalDataset,
  getNegativeKeywords,
  updateVersion,
  checkDuplication,
} from '@/services/dataset'
import { transferDatasetGroup, transferDataset, transferDatasetAnalysis, transferAnnotationsCount } from '@/constants/dataset'
import { actions, updateResultState, updateResultByTask, ResultStates } from '@/constants/common'
import { createEffect, createReducers } from './_utils'
import { deepClone } from '@/utils/object'
import { TASKTYPES } from '@/constants/task'

const initQuery = { name: '', type: '', time: 0, current: 1, offset: 0, limit: 20 }

const list = [
  { name: 'UPDATE_ALL_DATASETS', field: 'allDatasets' },
  { name: 'UpdateTotal', field: 'total' },
  { name: 'UpdateVersions', field: 'versions' },
]

const initState = {
  query: { ...initQuery },
  datasets: {},
  versions: {},
  dataset: {},
  assets: { items: [], total: 0 },
  asset: { annotations: [] },
  allDatasets: {},
  publicDatasets: [],
  total: 0,
}

export default {
  namespace: 'dataset',
  state: deepClone(initState),
  effects: {
    *getDatasetGroups({ payload }, { call, put }) {
      const { pid, query } = payload
      const { code, result } = yield call(getDatasetGroups, pid, query)
      if (code === 0) {
        const groups = result.items.map((item) => transferDatasetGroup(item))
        const payload = { items: groups, total: result.total }
        yield put({
          type: 'UPDATE_DATASETS',
          payload: { [pid]: payload },
        })
        for (let index = 0; index < groups.length; index++) {
          const group = groups[index]
          if (!group) {
            continue
          }
          yield put({
            type: 'UpdateVersions',
            payload: {
              [group.id]: group.versions,
            },
          })
        }
        return payload
      }
    },
    *batchLocalDatasets({ payload }, { call, put }) {
      const { pid, ids, ck } = payload
      const cache = yield put.resolve({
        type: 'getLocalDatasets',
        payload: ids,
      })
      const fixedCache = cache.filter((item) => !item.needReload)
      if (ids.length === fixedCache.length) {
        return cache
      }
      const fetchIds = ids.filter((id) => fixedCache.every((ds) => ds.id !== id))
      const remoteDatasets = yield put.resolve({
        type: 'batchDatasets',
        payload: { pid, ids: fetchIds, ck },
      })
      return [...fixedCache, ...(remoteDatasets || [])]
    },
    *batchDatasets({ payload }, { call, put }) {
      const { pid, ids, ck } = payload
      if (!ids?.length) {
        return []
      }
      const { code, result } = yield call(batchDatasets, pid, ids, ck)
      if (code === 0) {
        const datasets = result.map((ds) => transferDataset(ds))
        yield put({
          type: 'updateLocalDatasets',
          payload: datasets,
        })
        return datasets || []
      }
    },
    batch: createEffect(function* ({ payload }, { put }) {
      return yield put.resolve({
        type: 'batchLocalDatasets',
        payload,
      })
    }),
    *getDataset({ payload }, { call, put, select }) {
      const { id, verbose, force } = payload
      if (!force) {
        const dataset = yield select((state) => state.dataset.dataset[id])
        if (dataset) {
          return dataset
        }
      }
      const { code, result } = yield call(getDataset, id, verbose)
      if (code === 0) {
        const dataset = transferDataset(result)

        if (dataset.projectId) {
          const presult = yield put.resolve({
            type: 'project/getProject',
            payload: { id: dataset.projectId },
          })
          if (presult) {
            dataset.project = presult
          }
        }
        yield put({
          type: 'UPDATE_DATASET',
          payload: { id: dataset.id, dataset },
        })
        return dataset
      }
    },
    *getDatasetVersions({ payload }, { select, call, put }) {
      const { gid, force } = payload
      if (!force) {
        const versions = yield select(({ dataset }) => dataset.versions)
        if (versions[gid]) {
          return versions[gid]
        }
      }
      const { code, result } = yield call(getDatasetByGroup, gid)
      if (code === 0) {
        const vss = result.items.map((item) => transferDataset(item))
        yield put({
          type: 'UpdateVersions',
          payload: {
            [gid]: vss,
          },
        })
        return vss
      }
    },
    *queryDatasets({ payload }, { select, call, put }) {
      const { code, result } = yield call(queryDatasets, payload)
      if (code === 0) {
        return { items: result.items.map((ds) => transferDataset(ds)), total: result.total }
      }
    },
    *getHiddenList({ payload }, { put }) {
      const query = { order_by: 'update_datetime', ...payload, excludeType: TASKTYPES.INFERENCE, visible: false }
      return yield put({
        type: 'queryDatasets',
        payload: query,
      })
    },
    *queryAllDatasets({ payload }, { select, call, put }) {
      const loading = yield select(({ loading }) => {
        return loading.effects['dataset/queryDatasets']
      })
      const { pid, force } = payload
      if (!force) {
        const dssCache = yield select((state) => state.dataset.allDatasets[pid])
        if (dssCache.length) {
          return dssCache
        }
      }
      if (loading) {
        return
      }
      const dss = yield put.resolve({ type: 'queryDatasets', payload: { pid, state: ResultStates.VALID, limit: 10000 } })
      if (dss) {
        yield put({
          type: 'UPDATE_ALL_DATASETS',
          payload: { [pid]: dss.items },
        })
        return dss.items
      }
    },
    *delDataset({ payload }, { call, put }) {
      const { code, result } = yield call(delDataset, payload)
      if (code === 0) {
        yield put({
          type: 'UPDATE_DATASET',
          payload: { id: payload, dataset: null },
        })
        return result
      }
    },
    *delDatasetGroup({ payload }, { call, put }) {
      const { code, result } = yield call(delDatasetGroup, payload)
      if (code === 0) {
        return result
      }
    },
    *hide({ payload: { pid, ids = [] } }, { call, put }) {
      const { code, result } = yield call(batchAct, actions.hide, pid, ids)
      if (code === 0) {
        return result.map(transferDataset)
      }
    },
    *restore({ payload: { pid, ids = [] } }, { call, put }) {
      const { code, result } = yield call(batchAct, actions.restore, pid, ids)
      if (code === 0) {
        yield put.resolve({ type: 'clearCache' })
        return result
      }
    },
    *createDataset({ payload }, { call, put }) {
      const { code, result } = yield call(createDataset, payload)
      if (code === 0) {
        // yield put.resolve({ type: 'clearCache' })
        return result
      }
    },
    *updateDataset({ payload }, { call, put }) {
      const { id, name } = payload
      const { code, result } = yield call(updateDataset, id, name)
      if (code === 0) {
        return result
      }
    },
    getValidDatasetsCount: createEffect(function* ({ payload: pid }, { call, put }) {
      const result = yield put.resolve({
        type: 'queryDatasets',
        payload: {
          pid,
          state: ResultStates.VALID,
          empty: false,
        },
      })
      if (result?.total) {
        yield put({
          type: 'UpdateTotal',
          payload: result.total,
        })
        return result.total
      }
    }),
    *updateVersion({ payload }, { call, put }) {
      const { id, description } = payload
      const { code, result } = yield call(updateVersion, id, description)
      if (code === 0) {
        return transferDataset(result)
      }
    },
    *getInternalDataset({ payload }, { call, put }) {
      const { code, result } = yield call(getInternalDataset, payload)
      if (code === 0) {
        const dss = result.items.map((item) => transferDataset(item))
        const ds = { items: dss, total: result.total }
        yield put({
          type: 'UPDATE_PUBLICDATASETS',
          payload: ds,
        })
        return ds
      }
    },
    *updateDatasets({ payload }, { put, select }) {
      const versions = yield select((state) => state.dataset.versions)
      const tasks = payload || {}
      Object.keys(versions).forEach((gid) => {
        const datasets = versions[gid]
        let updatedDatasets = datasets.map((dataset) => {
          const updatedDataset = updateResultState(dataset, tasks)
          return updatedDataset ? { ...updatedDataset } : dataset
        })
        versions[gid] = updatedDatasets
      })
      yield put({
        type: 'UPDATE_ALL_VERSIONS',
        payload: { ...versions },
      })
      return { ...versions }
    },
    *updateAllDatasets({ payload: tasks = {} }, { put, select }) {
      const newDatasets = Object.values(tasks)
        .filter((task) => task.result_state === ResultStates.VALID)
        .map((task) => ({ id: task?.result_dataset?.id, needReload: true }))
      const pid = yield select(({ project }) => project.current?.id)
      if (newDatasets.length) {
        yield put({
          type: 'queryAllDatasets',
          payload: { pid, force: true },
        })
      }
    },
    *updateDatasetState({ payload }, { put, select }) {
      const caches = yield select((state) => state.dataset.dataset)
      const tasks = Object.values(payload || {})
      for (let index = 0; index < tasks.length; index++) {
        const task = tasks[index]
        const dataset = caches[task?.result_dataset?.id]
        if (!dataset) {
          continue
        }
        const updated = updateResultByTask(dataset, task)
        if (updated?.id) {
          if (updated.needReload) {
            yield put({
              type: 'getDataset',
              payload: { id: updated.id, force: true },
            })
          } else {
            yield put({
              type: 'UPDATE_DATASET',
              payload: { id: updated.id, dataset: { ...updated } },
            })
          }
        }
      }
    },
    *updateQuery({ payload = {} }, { put, select }) {
      const query = yield select(({ task }) => task.query)
      yield put({
        type: 'UPDATE_QUERY',
        payload: {
          ...query,
          ...payload,
          offset: query.offset === payload.offset ? initQuery.offset : payload.offset,
        },
      })
    },
    *resetQuery({}, { put }) {
      yield put({
        type: 'UPDATE_QUERY',
        payload: initQuery,
      })
    },
    *clearCache({}, { put }) {
      yield put({ type: 'CLEAR_ALL' })
    },
    *analysis({ payload }, { call, put }) {
      const { pid, datasets } = payload
      const { code, result } = yield call(analysis, pid, datasets)
      if (code === 0) {
        return result.map((item) => transferDatasetAnalysis(item))
      }
    },
    *checkDuplication({ payload }, { call, put, select }) {
      const { trainSet, validationSet } = payload
      const pid = yield select(({ project }) => project.current?.id)
      const { code, result } = yield call(checkDuplication, pid, trainSet, validationSet)
      if (code === 0) {
        return result
      }
    },
    *update({ payload }, { put, select }) {
      const ds = transferDataset(payload)
      if (!ds.id) {
        return
      }
      const { versions } = yield select(({ dataset }) => dataset)
      // update versions
      const target = versions[ds.groupId] || []
      yield put({
        type: 'UpdateVersions',
        payload: {
          [ds.groupId]: [ds, ...target],
        },
      })
      // update dataset
      yield put({
        type: 'UPDATE_DATASET',
        payload: {
          id: ds.id,
          dataset: ds,
        },
      })
    },
    *getNegativeKeywords({ payload }, { put, call, select }) {
      const { code, result } = yield call(getNegativeKeywords, { ...payload })
      if (code === 0) {
        const { gt, pred, total_assets_count } = result
        const getStats = (o = {}) => transferAnnotationsCount(o.keywords, o.negative_assets_count, total_assets_count)
        return getStats(gt)
      }
    },
    *getCK({ payload }, { select, put }) {
      const { ids = [], pid } = payload
      const datasets = yield put.resolve({ type: 'batchDatasets', payload: { pid, ids, ck: true } })
      return datasets || []
    },
    *updateLocalDatasets({ payload: datasets }, { put }) {
      for (let i = 0; i < datasets.length; i++) {
        const dataset = datasets[i]
        if (dataset?.id) {
          yield put({
            type: 'UPDATE_DATASET',
            payload: { id: dataset.id, dataset },
          })
        }
      }
    },
    *getLocalDatasets({ payload: ids = [] }, { put, select }) {
      const datasets = yield select(({ dataset }) => dataset.dataset)
      return ids.map((id) => datasets[id]).filter((d) => d)
    },
  },
  reducers: {
    ...createReducers(list),
    UPDATE_DATASETS(state, { payload }) {
      return {
        ...state,
        datasets: payload,
      }
    },
    UPDATE_ALL_VERSIONS(state, { payload }) {
      return {
        ...state,
        versions: { ...payload },
      }
    },
    UPDATE_DATASET(state, { payload }) {
      const { id, dataset } = payload
      const dss = { ...state.dataset, [id]: dataset }
      return {
        ...state,
        dataset: dss,
      }
    },
    UPDATE_ALL_DATASET(state, { payload }) {
      const dataset = payload
      return {
        ...state,
        dataset,
      }
    },
    UPDATE_ASSETS(state, { payload }) {
      return {
        ...state,
        assets: payload,
      }
    },
    UPDATE_ASSET(state, { payload }) {
      return {
        ...state,
        asset: payload,
      }
    },
    UPDATE_PUBLICDATASETS(state, { payload }) {
      return {
        ...state,
        publicDatasets: payload,
      }
    },
    UPDATE_QUERY(state, { payload }) {
      return {
        ...state,
        query: payload,
      }
    },
    CLEAR_ALL() {
      return deepClone(initState)
    },
  },
}
