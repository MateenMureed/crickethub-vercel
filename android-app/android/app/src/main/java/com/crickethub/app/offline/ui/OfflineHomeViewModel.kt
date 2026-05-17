package com.crickethub.app.offline.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.crickethub.app.offline.connectivity.ConnectivityMonitor
import com.crickethub.app.offline.repository.OfflineHomeSnapshot
import com.crickethub.app.offline.repository.OfflineRepository
import com.crickethub.app.offline.sync.OfflineSyncScheduler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class OfflineHomeUiState(
    val snapshot: OfflineHomeSnapshot? = null,
    val online: Boolean = true,
    val initialLoading: Boolean = true,
)

class OfflineHomeViewModel(
    private val repository: OfflineRepository,
    private val connectivityMonitor: ConnectivityMonitor,
    private val onRequestSyncNow: () -> Unit,
) : ViewModel() {

    private val _uiState = MutableStateFlow(OfflineHomeUiState())
    val uiState: StateFlow<OfflineHomeUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.observeHomeSnapshot().collectLatest { snapshot ->
                _uiState.update {
                    it.copy(snapshot = snapshot, initialLoading = snapshot.matches.isEmpty() && snapshot.liveScores.isEmpty())
                }
            }
        }

        viewModelScope.launch {
            connectivityMonitor.observeOnlineState().collectLatest { online ->
                _uiState.update { it.copy(online = online) }
                if (online) onRequestSyncNow()
            }
        }

        refreshSilently()
    }

    fun refreshSilently() {
        onRequestSyncNow()
        viewModelScope.launch {
            runCatching { repository.refreshAll() }
        }
    }
}

class OfflineHomeViewModelFactory(
    private val repository: OfflineRepository,
    private val connectivityMonitor: ConnectivityMonitor,
    private val onRequestSyncNow: () -> Unit,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(OfflineHomeViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return OfflineHomeViewModel(repository, connectivityMonitor, onRequestSyncNow) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
