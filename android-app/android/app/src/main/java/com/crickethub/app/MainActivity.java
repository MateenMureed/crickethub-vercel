package com.crickethub.app;

import android.os.Bundle;
import android.view.View;

import com.getcapacitor.BridgeActivity;
import com.crickethub.app.offline.sync.OfflineSyncScheduler;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		OfflineSyncScheduler.scheduleOneTimeOnAppOpen(getApplicationContext());
		if (bridge != null && bridge.getWebView() != null) {
			bridge.getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
			bridge.getWebView().setVerticalScrollBarEnabled(false);
			bridge.getWebView().setHorizontalScrollBarEnabled(false);
		}
	}
}
